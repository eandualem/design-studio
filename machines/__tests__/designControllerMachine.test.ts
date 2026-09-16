import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActor, fromPromise, setup } from "xstate";
import {
  designControllerMachine,
  QUIET_MS,
  type DesignControllerParentEvents,
  type Utterance,
} from "@/machines/designControllerMachine";
import type { Decision, DecisionRequest, HostActionResult, HostContext } from "@/types";

const hostContext: HostContext = {
  version: 1,
  host: { name: "design-studio", kind: "browser", version: "test" },
  view: { name: "files", data: { documents: [] } },
  captured_at: "2026-09-16T00:00:00Z",
};

const heard = (text: string, at = 1000): Utterance => ({
  conversation: [{ role: "user", content: text }],
  utterance: text,
  at,
});

const replaceBlock: Decision = {
  kind: "pending",
  model: "cerebras:qwen-3.8-27b",
  action: { callId: "call-1", toolName: "replace_block", arguments: { block_id: "b1", content: "# New" }, queued: [] },
};

function harness() {
  const requests: DecisionRequest[] = [];
  const receipts: { sessionId: string; result: HostActionResult }[] = [];
  const outcomes: (Decision | Error)[] = [];
  let resolveDecision: ((d: Decision) => void) | null = null;
  let receiptFails = false;

  const decider = fromPromise<Decision, DecisionRequest>(({ input }) => {
    requests.push(input);
    const next = outcomes.shift();
    if (next instanceof Error) return Promise.reject(next);
    if (next) return Promise.resolve(next);
    return new Promise<Decision>((resolve) => {
      resolveDecision = resolve;
    });
  });
  const receipt = fromPromise<void, { sessionId: string; result: HostActionResult }>(async ({ input }) => {
    receipts.push(input);
    if (receiptFails) throw new Error("409 late receipt");
  });

  const toParent: DesignControllerParentEvents[] = [];
  const notifications: string[] = [];
  const parent = createActor(
    setup({
      actors: { controller: designControllerMachine.provide({ actors: { decider, receipt } }) },
    }).createMachine({
      invoke: { id: "controller", src: "controller" },
      on: {
        "controller.hostAction": { actions: ({ event }) => toParent.push(event as DesignControllerParentEvents) },
        "controller.fact": { actions: ({ event }) => toParent.push(event as DesignControllerParentEvents) },
      },
    }),
  );
  parent.start();
  const actor = parent.getSnapshot().children.controller as ReturnType<
    typeof createActor<typeof designControllerMachine>
  >;
  actor.on("notification", (e) => notifications.push(e.message));
  const state = () => actor.getSnapshot().value;
  const ctx = () => actor.getSnapshot().context;
  const flush = () => vi.advanceTimersByTimeAsync(0);
  return {
    actor,
    parent,
    requests,
    receipts,
    outcomes,
    toParent,
    notifications,
    state,
    ctx,
    flush,
    resolve: (d: Decision) => {
      resolveDecision?.(d);
      resolveDecision = null;
    },
    failReceipts: () => {
      receiptFails = true;
    },
    utter: (text: string, at?: number) =>
      actor.send({ type: "app.utterance", utterance: heard(text, at), hostContext }),
    result: (result: HostActionResult) =>
      actor.send({ type: "app.actionResult", result, hostContext: { ...hostContext, captured_at: "later" } }),
  };
}

describe("designControllerMachine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ignores speech until a call starts, then waits for a pause before deciding", async () => {
    const h = harness();
    h.utter("Design a payment service");
    expect(h.state()).toBe("idle");
    h.actor.send({ type: "app.callStarted" });
    h.utter("Design a payment service");
    expect(h.state()).toBe("waiting");
    await vi.advanceTimersByTimeAsync(QUIET_MS - 1);
    expect(h.requests).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.state()).toBe("deciding");
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0].conversation).toEqual([{ role: "user", content: "Design a payment service" }]);
    expect(h.requests[0].sessionId).toMatch(/^design-/);
    expect(h.requests[0].hostContext).toBe(hostContext);
    h.parent.stop();
  });

  it("restarts the quiet period while the person keeps talking and decides once on the latest text", async () => {
    const h = harness();
    h.actor.send({ type: "app.callStarted" });
    h.utter("So the API");
    await vi.advanceTimersByTimeAsync(QUIET_MS - 100);
    h.utter("So the API talks to a worker");
    await vi.advanceTimersByTimeAsync(QUIET_MS - 100);
    expect(h.requests).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0].conversation[0].content).toBe("So the API talks to a worker");
    h.parent.stop();
  });

  it("holds without touching the document and logs the decision", async () => {
    const h = harness();
    h.outcomes.push({ kind: "hold", model: "m" });
    h.actor.send({ type: "app.callStarted" });
    h.utter("Hello there");
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    await h.flush();
    expect(h.state()).toBe("listening");
    expect(h.toParent).toEqual([]);
    expect(h.ctx().decisions).toHaveLength(1);
    expect(h.ctx().decisions[0]).toMatchObject({ status: "held", utterance: "Hello there", model: "m" });
    expect(h.ctx().decisions[0].returnedAt).not.toBeNull();
    h.parent.stop();
  });

  it("hands a decided action to the app, receipts its result and tells Live what changed", async () => {
    const h = harness();
    h.outcomes.push(replaceBlock);
    h.actor.send({ type: "app.callStarted" });
    h.utter("Add a queue between the API and the worker", 5000);
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    await h.flush();
    expect(h.state()).toBe("executing");
    expect(h.toParent).toEqual([{ type: "controller.hostAction", action: replaceBlock.action }]);
    expect(h.ctx().decisions[0]).toMatchObject({ status: "executing", action: "replace_block b1" });

    h.result({ callId: "call-1", outcome: "success", result: { applied: true, block_id: "b1", render: { ok: true } } });
    await h.flush();
    expect(h.state()).toBe("listening");
    expect(h.receipts).toEqual([
      {
        sessionId: h.requests[0].sessionId,
        result: { callId: "call-1", outcome: "success", result: { applied: true, block_id: "b1", render: { ok: true } } },
      },
    ]);
    expect(h.toParent[1]).toEqual({
      type: "controller.fact",
      fact: { action: "replace_block", status: "applied", block: "b1", summary: "# New", render: null },
    });
    const decision = h.ctx().decisions[0];
    expect(decision.status).toBe("applied");
    expect(decision.appliedAt).toBeGreaterThanOrEqual(decision.utteranceAt);
    expect(h.ctx().hostContext?.captured_at).toBe("later");
    expect(h.ctx().current).toBeNull();
    h.parent.stop();
  });

  it("keeps the in-flight decision when more speech arrives, then decides again on the new text", async () => {
    const h = harness();
    h.actor.send({ type: "app.callStarted" });
    h.utter("Add a queue");
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(h.state()).toBe("deciding");
    h.utter("Add a queue and a dead-letter queue");
    expect(h.state()).toBe("deciding");
    expect(h.ctx().pending?.utterance).toBe("Add a queue and a dead-letter queue");

    h.resolve(replaceBlock);
    await h.flush();
    expect(h.state()).toBe("executing");
    h.result({ callId: "call-1", outcome: "success", result: { applied: true } });
    await h.flush();
    expect(h.state()).toBe("waiting");
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(h.requests).toHaveLength(2);
    expect(h.requests[1].conversation[0].content).toBe("Add a queue and a dead-letter queue");
    expect(h.requests[1].sessionId).not.toBe(h.requests[0].sessionId);
    h.parent.stop();
  });

  it("fails one decision visibly and keeps listening", async () => {
    const h = harness();
    h.outcomes.push(new Error("Subscription-only routing requires an openai: model"));
    h.actor.send({ type: "app.callStarted" });
    h.utter("Add a queue");
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    await h.flush();
    expect(h.state()).toBe("listening");
    expect(h.ctx().decisions[0]).toMatchObject({
      status: "failed",
      detail: "Subscription-only routing requires an openai: model",
    });
    expect(h.notifications).toEqual(["Design decision failed: Subscription-only routing requires an openai: model"]);
    expect(h.toParent).toEqual([]);
    h.parent.stop();
  });

  it("stop cancels the decision in flight and drops queued speech", async () => {
    const h = harness();
    h.actor.send({ type: "app.callStarted" });
    h.utter("Add a queue");
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    h.utter("Add a queue, actually two");
    h.actor.send({ type: "user.stop" });
    expect(h.state()).toBe("listening");
    expect(h.ctx().pending).toBeNull();
    expect(h.ctx().decisions[0].status).toBe("cancelled");
    h.resolve(replaceBlock);
    await h.flush();
    expect(h.state()).toBe("listening");
    expect(h.toParent).toEqual([]);
    h.parent.stop();
  });

  it("stop during execution lets the edit finish but decides no further", async () => {
    const h = harness();
    h.outcomes.push(replaceBlock);
    h.actor.send({ type: "app.callStarted" });
    h.utter("Add a queue");
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    await h.flush();
    h.utter("and a cache");
    h.actor.send({ type: "user.stop" });
    expect(h.state()).toBe("executing");
    h.result({ callId: "call-1", outcome: "success", result: { applied: true } });
    await h.flush();
    expect(h.receipts).toHaveLength(1);
    expect(h.state()).toBe("listening");
    h.parent.stop();
  });

  it("reports a failed action to Live and a lost receipt to the person", async () => {
    const h = harness();
    h.outcomes.push(replaceBlock);
    h.failReceipts();
    h.actor.send({ type: "app.callStarted" });
    h.utter("Add a queue");
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    await h.flush();
    h.result({ callId: "call-1", outcome: "failed", result: { error: "no such block" } });
    await h.flush();
    expect(h.toParent[1]).toMatchObject({ type: "controller.fact", fact: { status: "failed", render: "no such block" } });
    expect(h.ctx().decisions[0]).toMatchObject({ status: "failed", detail: "Receipt not recorded: 409 late receipt" });
    expect(h.notifications).toEqual(["The document changed, but the runtime did not record the receipt."]);
    expect(h.state()).toBe("listening");
    h.parent.stop();
  });

  it("the end of the call abandons everything and returns to idle", async () => {
    const h = harness();
    h.actor.send({ type: "app.callStarted" });
    h.utter("Add a queue");
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    h.actor.send({ type: "app.callEnded" });
    expect(h.state()).toBe("idle");
    expect(h.ctx().decisions[0].status).toBe("cancelled");
    h.utter("still talking");
    expect(h.state()).toBe("idle");
    h.parent.stop();
  });

  it("remembers the chosen model and sends it with the next decision only", async () => {
    const h = harness();
    h.actor.send({ type: "user.selectModel", model: "cerebras:qwen-3.8-27b" });
    expect(h.ctx().model).toBe("cerebras:qwen-3.8-27b");
    h.actor.send({ type: "app.callStarted" });
    h.utter("Add a queue");
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(h.requests[0].model).toBe("cerebras:qwen-3.8-27b");
    h.parent.stop();
  });
});
