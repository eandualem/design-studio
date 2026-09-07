import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActor, fromPromise, setup, type ActorRefFrom } from "xstate";
import { documentMachine, type DocumentParentEvents } from "@/machines/documentMachine";
import { MAX_SAVE_RETRIES, type StudioDocument } from "@/types";

const document: StudioDocument = {
  id: "synthetic", name: "fixture.md", content: "# Persisted", sessionId: "fixture-session", updatedAt: "2026-09-07T00:00:00Z",
};
const cleanup: (() => void)[] = [];

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup.splice(0).forEach((stop) => stop());
  vi.useRealTimers();
});

async function harness(save: (draft: StudioDocument) => Promise<void>) {
  const received: DocumentParentEvents[] = [];
  const writes = vi.fn(save);
  const parent = createActor(setup({ actors: {
    document: documentMachine.provide({ actors: {
      saver: fromPromise<StudioDocument, { document: StudioDocument }>(async ({ input }) => {
        await writes(input.document);
        return input.document;
      }),
      renderer: fromPromise(async () => ({})),
    } }),
  } }).createMachine({
    invoke: { id: "document", src: "document", systemId: "document" },
    on: { "*": { actions: ({ event }) => received.push(event as DocumentParentEvents) } },
  }));
  parent.start();
  cleanup.push(() => parent.stop());
  const actor = parent.system.get("document") as ActorRefFrom<typeof documentMachine>;
  actor.send({ type: "app.open", document });
  await vi.advanceTimersByTimeAsync(0);
  return { actor, writes, received };
}

describe("document save recovery", () => {
  it("explains an IndexedDB transaction abort that rejects without an error object", async () => {
    const { actor } = await harness(() => Promise.reject(null));
    actor.send({ type: "user.edit", content: "# Draft" });
    await vi.advanceTimersByTimeAsync(500);
    expect(actor.getSnapshot().context.saveError).toBe("Could not save to this browser. Check available storage and retry.");
  });

  it("keeps a failed draft, retries automatically and reports saved only after storage succeeds", async () => {
    let attempts = 0;
    const { actor, writes, received } = await harness(async () => {
      if (++attempts === 1) throw new Error("Storage unavailable");
    });
    actor.send({ type: "user.edit", content: "# Latest draft" });
    await vi.advanceTimersByTimeAsync(500);
    expect(actor.getSnapshot().matches({ open: { saveFailed: "retrying" } })).toBe(true);
    expect(actor.getSnapshot().context.document?.content).toBe("# Latest draft");
    expect(actor.getSnapshot().context.saveError).toContain("Storage unavailable");
    expect(received.filter((event) => event.type === "document.saved")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1500);
    expect(writes).toHaveBeenCalledTimes(2);
    expect(actor.getSnapshot().matches({ open: "ready" })).toBe(true);
    expect(actor.getSnapshot().context).toMatchObject({ saveError: null, retryCount: 0 });
    expect(received.filter((event) => event.type === "document.saved")).toHaveLength(1);
  });

  it("stops after the retry budget, then accepts only one manual retry and recovers", async () => {
    let failing = true;
    const { actor, writes } = await harness(async () => { if (failing) throw new Error("Quota"); });
    actor.send({ type: "user.edit", content: "# Kept in memory" });
    await vi.advanceTimersByTimeAsync(20000);
    expect(writes).toHaveBeenCalledTimes(1 + MAX_SAVE_RETRIES);
    expect(actor.getSnapshot().matches({ open: { saveFailed: "failed" } })).toBe(true);
    expect(actor.getSnapshot().context.document?.content).toBe("# Kept in memory");
    failing = false;
    actor.send({ type: "user.retrySave" });
    actor.send({ type: "user.retrySave" });
    actor.send({ type: "user.retrySave" });
    expect(actor.getSnapshot().context.saveError).not.toBeNull();
    await vi.advanceTimersByTimeAsync(20000);
    expect(writes).toHaveBeenCalledTimes(2 + MAX_SAVE_RETRIES);
    expect(actor.getSnapshot().matches({ open: "ready" })).toBe(true);
  });

  it("cancels an old retry delay and resets the budget when the user edits", async () => {
    let attempts = 0;
    const { actor, writes } = await harness(async () => { if (++attempts < 3) throw new Error("Transient"); });
    actor.send({ type: "user.edit", content: "# First draft" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(actor.getSnapshot().context.retryCount).toBe(1);
    actor.send({ type: "user.edit", content: "# Replacement draft" });
    expect(actor.getSnapshot().context.retryCount).toBe(0);
    await vi.advanceTimersByTimeAsync(20000);
    expect(writes).toHaveBeenCalledTimes(3);
    expect(writes.mock.calls[2][0].content).toBe("# Replacement draft");
    expect(actor.getSnapshot().matches({ open: "ready" })).toBe(true);
  });

  it("serializes edits during an outstanding write and never marks the newer draft saved early", async () => {
    const completions: (() => void)[] = [];
    const { actor, writes } = await harness(() => new Promise((resolve) => completions.push(resolve)));
    actor.send({ type: "user.edit", content: "# First" });
    await vi.advanceTimersByTimeAsync(500);
    actor.send({ type: "user.edit", content: "# Second" });
    actor.send({ type: "user.edit", content: "# Newest" });
    actor.send({ type: "user.retrySave" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(actor.getSnapshot().matches({ open: { saving: "changed" } })).toBe(true);
    completions[0]();
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toHaveBeenCalledTimes(2);
    expect(writes.mock.calls[1][0].content).toBe("# Newest");
    expect(actor.getSnapshot().matches({ open: "saving" })).toBe(true);
    completions[1]();
    await vi.advanceTimersByTimeAsync(20000);
    expect(writes).toHaveBeenCalledTimes(2);
    expect(actor.getSnapshot().matches({ open: "ready" })).toBe(true);
  });

  it("saves the newest edit after an older in-flight write fails", async () => {
    let rejectOld: (error: Error) => void = () => {};
    let attempts = 0;
    const { actor, writes } = await harness(async () => {
      if (++attempts === 1) await new Promise<void>((_resolve, reject) => { rejectOld = reject; });
    });
    actor.send({ type: "user.edit", content: "# Old draft" });
    await vi.advanceTimersByTimeAsync(500);
    actor.send({ type: "user.edit", content: "# Latest draft" });
    rejectOld(new Error("Aborted"));
    await vi.advanceTimersByTimeAsync(0);
    expect(actor.getSnapshot().matches({ open: "dirty" })).toBe(true);
    await vi.advanceTimersByTimeAsync(20000);
    expect(writes).toHaveBeenCalledTimes(2);
    expect(writes.mock.calls[1][0].content).toBe("# Latest draft");
    expect(actor.getSnapshot().context.saveError).toBeNull();
  });

  it("replies failed once when a host edit cannot be persisted after retries", async () => {
    const { actor, received } = await harness(async () => { throw new Error("Quota"); });
    actor.send({ type: "app.execute", callId: "host-edit", sessionId: "fixture-session", name: "replace_block", args: { block_id: "b0", content: "# Host draft" } });
    await vi.advanceTimersByTimeAsync(20000);
    const results = received.filter((event) => event.type === "document.actionResult");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ outcome: "failed", callId: "host-edit" });
    expect(actor.getSnapshot().context.pending).toBeNull();
    expect(actor.getSnapshot().context.document?.content).toContain("Host draft");
  });

  it("replies to a host edit only once its automatic save retry succeeds", async () => {
    let attempts = 0;
    const { actor, received } = await harness(async () => { if (++attempts === 1) throw new Error("Transient"); });
    actor.send({ type: "app.execute", callId: "host-edit", sessionId: "fixture-session", name: "replace_block", args: { block_id: "b0", content: "# Host draft" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(received.filter((event) => event.type === "document.actionResult")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1500);
    expect(received.filter((event) => event.type === "document.actionResult")).toMatchObject([{ outcome: "success", callId: "host-edit" }]);
    expect(actor.getSnapshot().context.pending).toBeNull();
  });

  it("cancels scheduled retries when another document opens", async () => {
    const { actor, writes } = await harness(async () => { throw new Error("Quota"); });
    actor.send({ type: "user.edit", content: "# Failed draft" });
    await vi.advanceTimersByTimeAsync(500);
    actor.send({ type: "app.open", document: { ...document, id: "second" } });
    await vi.advanceTimersByTimeAsync(20000);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(actor.getSnapshot().context).toMatchObject({ saveError: null, retryCount: 0 });
    expect(actor.getSnapshot().context.document?.id).toBe("second");
  });
});
