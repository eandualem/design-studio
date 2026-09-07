import { describe, expect, it } from "vitest";
import { buildHostContext, HOST_ACTIONS } from "@/lib/host-context";
import { HostContextSchema } from "@/types";

describe("buildHostContext", () => {
  it("produces a valid v1 context with a document open", () => {
    const ctx = buildHostContext({
      document: {
        id: "d1",
        name: "a.md",
        content: "# a",
        sessionId: "s1",
        updatedAt: "2026-09-06T00:00:00Z",
      },
      blocks: [
        { id: "b0", kind: "text", source: "# a", code: null, summary: "# a" },
        { id: "b1", kind: "diagram", source: "```mermaid\nflowchart LR\n```", code: "flowchart LR", summary: "mermaid: flowchart LR" },
      ],
      renderCache: { "flowchart LR": { ok: false, error: "bad" } },
      selection: "b1",
      documents: [{ id: "d1", name: "a.md", updatedAt: "2026-09-06T00:00:00Z" }],
      filesState: "ready",
      documentState: "open.ready",
    });
    expect(HostContextSchema.parse(ctx)).toBeTruthy();
    expect(ctx.view?.name).toBe("document");
    expect(ctx.view?.data?.document).toMatchObject({
      id: "d1",
      selection: "b1",
      blocks: [
        { block_id: "b0", kind: "text" },
        { block_id: "b1", kind: "diagram", render: { ok: false, error: "bad", block_id: "b1" } },
      ],
    });
    expect(ctx.navigation?.map((n) => n.name)).toEqual(["files", "document"]);
    expect(ctx.actions?.map((a) => a.name)).toEqual(HOST_ACTIONS.map((a) => a.name));
  });

  it("describes the file list when nothing is open", () => {
    const ctx = buildHostContext({
      document: null,
      blocks: [],
      renderCache: {},
      selection: null,
      documents: [],
      filesState: "ready",
      documentState: "closed",
    });
    expect(HostContextSchema.parse(ctx).view?.name).toBe("files");
    expect(ctx.attachments).toBeUndefined();
  });

  it("declares every host action with an object schema", () => {
    for (const action of HOST_ACTIONS) {
      expect(action.parameters.type).toBe("object");
      expect(action.name).toMatch(/^[a-z_]+$/);
    }
  });
});
