import { describe, expect, it } from "vitest";
import { applyEdit, parseBlocks, serializeBlocks } from "@/lib/blocks";

const DOC = `# Payment service

Handles card payments.

\`\`\`mermaid
flowchart TD
  API --> Worker
\`\`\`

- api
- worker

\`\`\`ts
const x = 1;
\`\`\`
`;

describe("parseBlocks", () => {
  it("splits headings, paragraphs and lists on blank lines and keeps fences atomic", () => {
    const blocks = parseBlocks(DOC);
    expect(blocks.map((b) => [b.id, b.kind])).toEqual([
      ["b0", "text"],
      ["b1", "text"],
      ["b2", "diagram"],
      ["b3", "text"],
      ["b4", "text"],
    ]);
    expect(blocks[2].code).toBe("flowchart TD\n  API --> Worker");
    expect(blocks[2].summary).toBe("mermaid: flowchart TD");
    expect(blocks[0].summary).toBe("# Payment service");
    expect(blocks[4].source).toBe("```ts\nconst x = 1;\n```");
  });

  it("round-trips through serializeBlocks", () => {
    expect(serializeBlocks(parseBlocks(DOC))).toBe(DOC);
  });

  it("does not split a fence that contains blank lines", () => {
    const blocks = parseBlocks("```mermaid\nflowchart LR\n\n  A --> B\n```\n");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].code).toBe("flowchart LR\n\n  A --> B");
  });

  it("keeps an unterminated fence as text", () => {
    const blocks = parseBlocks("```mermaid\nflowchart LR\n  A --> B\n");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("text");
  });

  it("returns no blocks for empty content", () => {
    expect(parseBlocks("")).toEqual([]);
    expect(parseBlocks("\n\n")).toEqual([]);
  });
});

describe("applyEdit", () => {
  it("replaces, inserts and deletes by block id", () => {
    const replaced = applyEdit(DOC, {
      type: "replace",
      blockId: "b2",
      content: "```mermaid\nflowchart LR\n  API --> Worker --> Postgres\n```",
    });
    if (!replaced.ok) throw new Error(replaced.error);
    expect(parseBlocks(replaced.content)[2].code).toBe(
      "flowchart LR\n  API --> Worker --> Postgres",
    );

    const inserted = applyEdit(DOC, { type: "insert", afterBlockId: "start", content: "Intro" });
    if (!inserted.ok) throw new Error(inserted.error);
    expect(parseBlocks(inserted.content)[0].source).toBe("Intro");

    const after = applyEdit(DOC, { type: "insert", afterBlockId: "b0", content: "After heading" });
    if (!after.ok) throw new Error(after.error);
    expect(parseBlocks(after.content)[1].source).toBe("After heading");

    const deleted = applyEdit(DOC, { type: "delete", blockId: "b1" });
    if (!deleted.ok) throw new Error(deleted.error);
    expect(parseBlocks(deleted.content).map((b) => b.summary)).not.toContain(
      "Handles card payments.",
    );
  });

  it("fails on an unknown block id without touching the content", () => {
    expect(applyEdit(DOC, { type: "delete", blockId: "b99" })).toEqual({
      ok: false,
      error: "unknown block id b99",
    });
  });

  it("deleting the last block yields an empty document", () => {
    expect(applyEdit("Only\n", { type: "delete", blockId: "b0" })).toEqual({
      ok: true,
      content: "",
    });
  });
});
