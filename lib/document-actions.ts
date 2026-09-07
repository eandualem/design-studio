import {
  EditActionSchema,
  type Block,
  type EditAction,
  type RenderReport,
  type RenderResult,
} from "@/types";
import { applyEdit, parseBlocks, type BlockEdit } from "./blocks";

/** Render results keyed by Mermaid source, so unchanged diagrams are not re-rendered. */
export type RenderCache = Record<string, RenderResult>;

export function renderFor(block: Block, cache: RenderCache): RenderResult | null {
  if (block.kind !== "diagram" || block.code === null) return null;
  return cache[block.code] ?? null;
}

/** Mermaid sources of the diagram blocks that are not in the cache yet. */
export function missingRenders(blocks: Block[], cache: RenderCache): string[] {
  const codes = new Set<string>();
  for (const b of blocks) {
    if (b.kind === "diagram" && b.code !== null && !(b.code in cache)) codes.add(b.code);
  }
  return [...codes];
}

export function reportFor(block: Block, cache: RenderCache): RenderReport {
  const r = renderFor(block, cache);
  if (!r || r.ok) return { ok: true };
  return { ok: false, error: r.error, block_id: block.id };
}

/** The first failing diagram, or ok: what create_document reports as `render`. */
export function reportForDocument(blocks: Block[], cache: RenderCache): RenderReport {
  for (const b of blocks) {
    const r = reportFor(b, cache);
    if (!r.ok) return r;
  }
  return { ok: true };
}

/** Block list as the host context and action results describe it. */
export function describeBlocks(blocks: Block[], cache: RenderCache) {
  return blocks.map((b) => ({
    block_id: b.id,
    kind: b.kind,
    summary: b.summary,
    ...(b.kind === "diagram" ? { render: reportFor(b, cache) } : {}),
  }));
}

export type ParsedAction =
  | { ok: true; action: EditAction }
  | { ok: false; error: string };

/** Validate a host tool call's name and arguments against the declared actions. */
export function parseAction(name: string, args: Record<string, unknown>): ParsedAction {
  const parsed = EditActionSchema.safeParse({ name, args });
  if (parsed.success) return { ok: true, action: parsed.data };
  const known = EditActionSchema.options.map((o) => o.shape.name.value);
  if (!known.includes(name as (typeof known)[number])) {
    return { ok: false, error: `unknown action ${name}` };
  }
  const issue = parsed.error.issues[0];
  return {
    ok: false,
    error: `invalid arguments for ${name}: ${issue.path.join(".") || "args"} ${issue.message}`,
  };
}

export function isEditAction(
  action: EditAction,
): action is Extract<EditAction, { name: "replace_block" | "insert_block" | "delete_block" }> {
  return (
    action.name === "replace_block" ||
    action.name === "insert_block" ||
    action.name === "delete_block"
  );
}

export function toBlockEdit(
  action: Extract<EditAction, { name: "replace_block" | "insert_block" | "delete_block" }>,
): BlockEdit {
  switch (action.name) {
    case "replace_block":
      return { type: "replace", blockId: action.args.block_id, content: action.args.content };
    case "insert_block":
      return {
        type: "insert",
        afterBlockId: action.args.after_block_id,
        content: action.args.content,
      };
    case "delete_block":
      return { type: "delete", blockId: action.args.block_id };
  }
}

export interface AppliedEdit {
  content: string;
  blocks: Block[];
  /** The block the result names (replaced or inserted), null for delete. */
  resultBlockId: string | null;
}

/** Apply an edit action to content and say which block the result refers to. */
export function applyEditAction(
  content: string,
  action: Extract<EditAction, { name: "replace_block" | "insert_block" | "delete_block" }>,
): { ok: true; edit: AppliedEdit } | { ok: false; error: string } {
  const edit = toBlockEdit(action);
  const result = applyEdit(content, edit);
  if (!result.ok) return result;
  const blocks = parseBlocks(result.content);
  let resultBlockId: string | null = null;
  if (edit.type === "replace") {
    resultBlockId = edit.blockId;
  } else if (edit.type === "insert") {
    if (edit.afterBlockId === "start") {
      resultBlockId = blocks[0]?.id ?? null;
    } else {
      const before = parseBlocks(content);
      const i = before.findIndex((b) => b.id === edit.afterBlockId);
      resultBlockId = blocks[i + 1]?.id ?? null;
    }
  }
  return { ok: true, edit: { content: result.content, blocks, resultBlockId } };
}

/** The tool_result for an edit action once rendering is done. */
export function editResult(
  action: EditAction,
  blocks: Block[],
  cache: RenderCache,
  resultBlockId: string | null,
): Record<string, unknown> {
  if (action.name === "delete_block") return { applied: true };
  const block = blocks.find((b) => b.id === resultBlockId);
  return {
    applied: true,
    block_id: resultBlockId,
    render: block ? reportFor(block, cache) : { ok: true },
  };
}
