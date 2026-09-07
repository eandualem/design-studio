import { describe, expect, it } from "vitest";
import { createActor, fromPromise, setup, type ActorRefFrom } from "xstate";
import { documentMachine, type DocumentParentEvents } from "@/machines/documentMachine";
import type { RenderCache } from "@/lib/document-actions";
import type { StudioDocument } from "@/types";

const DOC: StudioDocument = {
  id: "d1",
  name: "payments.md",
  content: "# Payments\n\n```mermaid\nflowchart TD\n  API --> Worker\n```\n",
  sessionId: "s1",
  updatedAt: "2026-09-06T00:00:00Z",
};

function harness(options: { renderFails?: RegExp; store?: StudioDocument[] } = {}) {
  const store = new Map((options.store ?? [DOC]).map((d) => [d.id, d]));
  const saved: StudioDocument[] = [];
  const rendered: string[][] = [];
  const renderer = fromPromise<RenderCache, { codes: string[] }>(async ({ input }) => {
    rendered.push(input.codes);
    const cache: RenderCache = {};
    for (const code of input.codes) {
      cache[code] = options.renderFails?.test(code)
        ? { ok: false, error: `Parse error in: ${code.split("\n")[0]}` }
        : { ok: true, svg: `<svg data-code="${code.length}"/>` };
    }
    return cache;
  });
  const saver = fromPromise<StudioDocument, { document: StudioDocument }>(async ({ input }) => {
    store.set(input.document.id, input.document);
    saved.push(input.document);
    return input.document;
  });
  const creator = fromPromise<StudioDocument, { name: string; content: string; sessionId: string }>(
    async ({ input }) => {
      const doc: StudioDocument = {
        id: "new",
        name: input.name,
        content: input.content,
        sessionId: input.sessionId,
        updatedAt: "t",
      };
      store.set(doc.id, doc);
      saved.push(doc);
      return doc;
    },
  );
  const finder = fromPromise<StudioDocument | null, { documentId?: string; name?: string; sessionId: string }>(
    async ({ input }) => {
      const found =
        [...store.values()].find((d) => d.id === input.documentId || d.name === input.name) ?? null;
      if (!found) return null;
      const adopted = { ...found, sessionId: input.sessionId };
      store.set(adopted.id, adopted);
      return adopted;
    },
  );
  const renamer = fromPromise<StudioDocument | null, { documentId: string; name: string }>(
    async ({ input }) => {
      const doc = store.get(input.documentId);
      if (!doc) return null;
      const renamed = { ...doc, name: input.name };
      store.set(renamed.id, renamed);
      return renamed;
    },
  );
  const received: DocumentParentEvents[] = [];
  const parent = createActor(
    setup({
      actors: {
        document: documentMachine.provide({ actors: { renderer, saver, creator, finder, renamer } }),
      },
    }).createMachine({
      invoke: { id: "document", src: "document", systemId: "document" },
      on: { "*": { actions: ({ event }) => received.push(event as DocumentParentEvents) } },
    }),
  );
  parent.start();
  const actor = parent.system.get("document") as ActorRefFrom<typeof documentMachine>;
  return {
    actor,
    received,
    saved,
    rendered,
    store,
    results: () =>
      received.filter((e): e is Extract<DocumentParentEvents, { type: "document.actionResult" }> =>
        e.type === "document.actionResult",
      ),
    execute: (callId: string, name: string, args: Record<string, unknown>) =>
      actor.send({ type: "app.execute", callId, name, args, sessionId: "s1" }),
  };
}

async function settle(ms = 5) {
  await new Promise((r) => setTimeout(r, ms));
}

describe("documentMachine", () => {
  it("opens a document, renders its diagrams once and reaches ready", async () => {
    const h = harness();
    h.actor.send({ type: "app.open", document: DOC });
    expect(h.actor.getSnapshot().value).toEqual({ open: "rendering" });
    await settle();
    expect(h.actor.getSnapshot().value).toEqual({ open: "ready" });
    expect(h.rendered).toEqual([["flowchart TD\n  API --> Worker"]]);
    expect(h.actor.getSnapshot().context.blocks.map((b) => b.kind)).toEqual(["text", "diagram"]);
  });

  it("saves user edits after the typing pause and renders only new diagrams", async () => {
    const h = harness();
    h.actor.send({ type: "app.open", document: DOC });
    await settle();
    h.actor.send({ type: "user.edit", content: DOC.content + "\nMore text.\n" });
    expect(h.actor.getSnapshot().value).toEqual({ open: "dirty" });
    await settle(600);
    expect(h.actor.getSnapshot().value).toEqual({ open: "ready" });
    expect(h.saved).toHaveLength(1);
    expect(h.saved[0].content).toContain("More text.");
    expect(h.received.some((e) => e.type === "document.saved")).toBe(true);
    expect(h.rendered).toHaveLength(2);
    expect(h.rendered[1]).toEqual([]);
  });

  it("replace_block applies, saves, renders and reports the render outcome", async () => {
    const h = harness({ renderFails: /BROKEN/ });
    h.actor.send({ type: "app.open", document: DOC });
    await settle();
    h.execute("c1", "replace_block", {
      block_id: "b1",
      content: "```mermaid\nflowchart LR\n  API --> BROKEN -->\n```",
    });
    await settle(20);
    expect(h.actor.getSnapshot().value).toEqual({ open: "ready" });
    expect(h.results()).toEqual([
      {
        type: "document.actionResult",
        callId: "c1",
        outcome: "success",
        result: {
          applied: true,
          block_id: "b1",
          render: { ok: false, error: "Parse error in: flowchart LR", block_id: "b1" },
        },
      },
    ]);
    expect(h.saved[0].content).toContain("BROKEN");
    expect(h.actor.getSnapshot().context.selection).toBe("b1");
    expect(h.actor.getSnapshot().context.pending).toBeNull();
  });

  it("insert_block names the inserted block and delete_block reports applied", async () => {
    const h = harness();
    h.actor.send({ type: "app.open", document: DOC });
    await settle();
    h.execute("c1", "insert_block", { after_block_id: "b0", content: "Intro." });
    await settle(20);
    expect(h.results()[0].result).toEqual({ applied: true, block_id: "b1", render: { ok: true } });
    h.execute("c2", "delete_block", { block_id: "b1" });
    await settle(20);
    expect(h.results()[1].result).toEqual({ applied: true });
    expect(h.actor.getSnapshot().context.blocks).toHaveLength(2);
  });

  it("fails an edit with an unknown block id or invalid arguments without changing the document", async () => {
    const h = harness();
    h.actor.send({ type: "app.open", document: DOC });
    await settle();
    h.execute("c1", "delete_block", { block_id: "b9" });
    await settle(20);
    h.execute("c2", "replace_block", { block_id: "b1" });
    await settle(20);
    h.execute("c3", "navigate", { page: "x" });
    await settle(20);
    expect(h.results().map((r) => [r.callId, r.outcome, r.result])).toEqual([
      ["c1", "failed", { error: "unknown block id b9" }],
      ["c2", "failed", { error: expect.stringContaining("invalid arguments for replace_block") }],
      ["c3", "failed", { error: "unknown action navigate" }],
    ]);
    expect(h.actor.getSnapshot().context.document?.content).toBe(DOC.content);
    expect(h.actor.getSnapshot().value).toEqual({ open: "ready" });
  });

  it("refuses an edit when no document is open and stays closed", async () => {
    const h = harness();
    h.execute("c1", "replace_block", { block_id: "b0", content: "x" });
    await settle();
    expect(h.results()[0]).toMatchObject({ outcome: "failed", result: { error: "no document is open" } });
    expect(h.actor.getSnapshot().value).toBe("closed");
  });

  it("create_document writes a document that adopts the session, opens it and reports blocks and render", async () => {
    const h = harness({ store: [] });
    h.execute("c1", "create_document", {
      name: "queue",
      content: "# Queue\n\n```mermaid\nflowchart LR\n  P --> Q\n```\n",
    });
    await settle(20);
    expect(h.actor.getSnapshot().value).toEqual({ open: "ready" });
    expect(h.received.map((e) => e.type)).toEqual([
      "document.saved",
      "document.opened",
      "document.actionResult",
    ]);
    expect(h.results()[0]).toMatchObject({
      outcome: "success",
      result: {
        document_id: "new",
        render: { ok: true },
        blocks: [
          { block_id: "b0", kind: "text" },
          { block_id: "b1", kind: "diagram", render: { ok: true } },
        ],
      },
    });
    expect(h.store.get("new")).toMatchObject({ name: "queue", sessionId: "s1" });
  });

  it("open_document finds by name, moves the conversation to it and reports blocks", async () => {
    const other: StudioDocument = { ...DOC, id: "d2", name: "other.md", sessionId: "old" };
    const h = harness({ store: [DOC, other] });
    h.execute("c1", "open_document", { name: "other.md" });
    await settle(20);
    expect(h.results()[0]).toMatchObject({
      outcome: "success",
      result: { document_id: "d2", blocks: expect.any(Array) },
    });
    expect(h.actor.getSnapshot().context.document).toMatchObject({ id: "d2", sessionId: "s1" });
    h.execute("c2", "open_document", { name: "missing.md" });
    await settle(20);
    expect(h.results()[1]).toMatchObject({ outcome: "failed", result: { error: "no such document" } });
    expect(h.actor.getSnapshot().value).toEqual({ open: "ready" });
  });

  it("rename_document renames the open document in place or another one in the store", async () => {
    const other: StudioDocument = { ...DOC, id: "d2", name: "other.md" };
    const h = harness({ store: [DOC, other] });
    h.actor.send({ type: "app.open", document: DOC });
    await settle();
    h.execute("c1", "rename_document", { document_id: "d1", name: "billing" });
    await settle(20);
    expect(h.results()[0]).toMatchObject({ outcome: "success", result: { applied: true } });
    expect(h.actor.getSnapshot().context.document?.name).toBe("billing.md");
    h.execute("c2", "rename_document", { document_id: "d2", name: "renamed.md" });
    await settle(20);
    expect(h.results()[1]).toMatchObject({ outcome: "success", result: { applied: true } });
    expect(h.store.get("d2")?.name).toBe("renamed.md");
    expect(h.actor.getSnapshot().context.document?.id).toBe("d1");
  });
});
