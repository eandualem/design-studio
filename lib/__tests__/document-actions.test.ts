import { describe, expect, it } from "vitest";
import {
  applyEditAction,
  describeBlocks,
  editResult,
  missingRenders,
  parseAction,
  reportForDocument,
} from "@/lib/document-actions";
import { parseBlocks } from "@/lib/blocks";

const DOC = "# Title\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\nText.\n";

describe("parseAction", () => {
  it("accepts the declared actions and rejects the rest", () => {
    expect(parseAction("replace_block", { block_id: "b1", content: "x" })).toMatchObject({
      ok: true,
      action: { name: "replace_block" },
    });
    expect(parseAction("open_document", { name: "a.md" })).toMatchObject({ ok: true });
    expect(parseAction("open_document", {})).toMatchObject({
      ok: false,
      error: expect.stringContaining("invalid arguments for open_document"),
    });
    expect(parseAction("replace_block", { block_id: "b1" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("content"),
    });
    expect(parseAction("navigate", { page: "x" })).toEqual({
      ok: false,
      error: "unknown action navigate",
    });
  });
});

describe("applyEditAction", () => {
  it("names the replaced or inserted block in the result", () => {
    const replaced = applyEditAction(DOC, {
      name: "replace_block",
      args: { block_id: "b1", content: "```mermaid\nflowchart TD\n  A --> B\n```" },
    });
    if (!replaced.ok) throw new Error(replaced.error);
    expect(replaced.edit.resultBlockId).toBe("b1");

    const inserted = applyEditAction(DOC, {
      name: "insert_block",
      args: { after_block_id: "b0", content: "Intro paragraph" },
    });
    if (!inserted.ok) throw new Error(inserted.error);
    expect(inserted.edit.resultBlockId).toBe("b1");
    expect(inserted.edit.blocks[1].source).toBe("Intro paragraph");

    const atStart = applyEditAction(DOC, {
      name: "insert_block",
      args: { after_block_id: "start", content: "First" },
    });
    if (!atStart.ok) throw new Error(atStart.error);
    expect(atStart.edit.resultBlockId).toBe("b0");

    expect(
      applyEditAction(DOC, { name: "delete_block", args: { block_id: "b7" } }),
    ).toEqual({ ok: false, error: "unknown block id b7" });
  });
});

describe("render reporting", () => {
  const blocks = parseBlocks(DOC);
  const code = "flowchart LR\n  A --> B";

  it("lists diagram sources that still need rendering", () => {
    expect(missingRenders(blocks, {})).toEqual([code]);
    expect(missingRenders(blocks, { [code]: { ok: true, svg: "<svg/>" } })).toEqual([]);
  });

  it("describes blocks with render reports and surfaces the first error", () => {
    const cache = { [code]: { ok: false as const, error: "Parse error on line 2" } };
    expect(describeBlocks(blocks, cache)).toEqual([
      { block_id: "b0", kind: "text", summary: "# Title" },
      {
        block_id: "b1",
        kind: "diagram",
        summary: "mermaid: flowchart LR",
        render: { ok: false, error: "Parse error on line 2", block_id: "b1" },
      },
      { block_id: "b2", kind: "text", summary: "Text." },
    ]);
    expect(reportForDocument(blocks, cache)).toEqual({
      ok: false,
      error: "Parse error on line 2",
      block_id: "b1",
    });
    expect(reportForDocument(blocks, { [code]: { ok: true, svg: "" } })).toEqual({ ok: true });
  });

  it("builds the brief's result shapes for edits", () => {
    const cache = { [code]: { ok: true as const, svg: "" } };
    expect(
      editResult({ name: "replace_block", args: { block_id: "b1", content: "" } }, blocks, cache, "b1"),
    ).toEqual({ applied: true, block_id: "b1", render: { ok: true } });
    expect(editResult({ name: "delete_block", args: { block_id: "b0" } }, blocks, cache, null)).toEqual({
      applied: true,
    });
  });
});
