import type { Block } from "@/types";

const SUMMARY_LIMIT = 80;
const FENCE = /^(```|~~~)\s*([\w-]*)\s*$/;

/** Split Markdown into blocks: fenced code is atomic, the rest splits on blank lines. */
export function parseBlocks(content: string): Block[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const raw: { kind: Block["kind"]; lines: string[]; code: string[] | null }[] = [];
  let current: string[] = [];
  let fence: { marker: string; lang: string; body: string[] } | null = null;

  const flushText = () => {
    if (current.some((l) => l.trim() !== "")) {
      raw.push({ kind: "text", lines: trimBlank(current), code: null });
    }
    current = [];
  };

  for (const line of lines) {
    if (fence) {
      if (line.trim() === fence.marker) {
        const isMermaid = fence.lang.toLowerCase() === "mermaid";
        const all = [`${fence.marker}${fence.lang}`, ...fence.body, fence.marker];
        if (isMermaid) {
          raw.push({ kind: "diagram", lines: all, code: fence.body });
        } else {
          current.push(...all);
        }
        fence = null;
      } else {
        fence.body.push(line);
      }
      continue;
    }
    const open = FENCE.exec(line);
    if (open) {
      const lang = open[2];
      if (lang.toLowerCase() === "mermaid") flushText();
      fence = { marker: open[1], lang, body: [] };
      continue;
    }
    if (line.trim() === "") {
      flushText();
      continue;
    }
    current.push(line);
  }
  if (fence) {
    current.push(`${fence.marker}${fence.lang}`, ...fence.body);
  }
  flushText();

  return raw.map((r, index) => {
    const source = r.lines.join("\n");
    return {
      id: `b${index}`,
      kind: r.kind,
      source,
      code: r.code ? r.code.join("\n") : null,
      summary: summarize(r.kind, r.kind === "diagram" ? (r.code ?? []) : r.lines),
    };
  });
}

function trimBlank(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start++;
  while (end > start && lines[end - 1].trim() === "") end--;
  return lines.slice(start, end);
}

function summarize(kind: Block["kind"], lines: string[]): string {
  const first = lines.find((l) => l.trim() !== "")?.trim() ?? "";
  const text = kind === "diagram" ? `mermaid: ${first}` : first;
  return text.length > SUMMARY_LIMIT ? `${text.slice(0, SUMMARY_LIMIT - 1)}…` : text;
}

/** Join blocks back into Markdown. */
export function serializeBlocks(blocks: Block[]): string {
  return blocks.map((b) => b.source).join("\n\n") + (blocks.length ? "\n" : "");
}

export type BlockEdit =
  | { type: "replace"; blockId: string; content: string }
  | { type: "insert"; afterBlockId: string; content: string }
  | { type: "delete"; blockId: string };

/**
 * Apply one edit to the document content. Returns the new content, or an
 * error when the referenced block does not exist. Ids are re-derived from
 * the current parse, so callers must use ids from the latest host context.
 */
export function applyEdit(
  content: string,
  edit: BlockEdit,
): { ok: true; content: string } | { ok: false; error: string } {
  const blocks = parseBlocks(content);
  const sources = blocks.map((b) => b.source);
  const indexOf = (id: string) => blocks.findIndex((b) => b.id === id);

  switch (edit.type) {
    case "replace": {
      const i = indexOf(edit.blockId);
      if (i < 0) return { ok: false, error: `unknown block id ${edit.blockId}` };
      sources.splice(i, 1, edit.content.trim());
      break;
    }
    case "insert": {
      if (edit.afterBlockId === "start") {
        sources.unshift(edit.content.trim());
        break;
      }
      const i = indexOf(edit.afterBlockId);
      if (i < 0) return { ok: false, error: `unknown block id ${edit.afterBlockId}` };
      sources.splice(i + 1, 0, edit.content.trim());
      break;
    }
    case "delete": {
      const i = indexOf(edit.blockId);
      if (i < 0) return { ok: false, error: `unknown block id ${edit.blockId}` };
      sources.splice(i, 1);
      break;
    }
  }
  const joined = sources.filter((s) => s.trim() !== "").join("\n\n");
  return { ok: true, content: joined ? `${joined}\n` : "" };
}

/** Index of the block whose id matches, or -1. */
export function blockIndex(blocks: Block[], id: string): number {
  return blocks.findIndex((b) => b.id === id);
}
