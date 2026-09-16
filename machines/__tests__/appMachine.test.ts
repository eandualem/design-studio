import { describe, expect, it } from "vitest";
import { createActor, fromCallback, fromObservable, fromPromise } from "xstate";
import { appMachine } from "@/machines/appMachine";
import { QUIET_MS } from "@/machines/designControllerMachine";
import { assistantMachine, type AssistantEvents, type SocketCommand } from "@/machines/assistantMachine";
import { documentMachine } from "@/machines/documentMachine";
import { filesMachine } from "@/machines/filesMachine";
import { artifactsMachine } from "@/machines/artifactsMachine";
import { designControllerMachine } from "@/machines/designControllerMachine";
import { voiceMachine } from "@/machines/voiceMachine";
import type { RenderCache } from "@/lib/document-actions";
import { ensureMarkdownName } from "@/lib/files-store";
import type { Decision, DecisionRequest, DesignFact, HostActionResult, MessageRecord, StudioDocument, TreeNode, VoiceView } from "@/types";
import { initialVoiceView } from "@/types";
import type { VoiceClient } from "@/lib/voice-client";

const DOC: StudioDocument = {
  id: "d1",
  name: "payments.md",
  content: "# Payments\n\n```mermaid\nflowchart TD\n  API --> Worker\n```\n",
  sessionId: "session-d1",
  updatedAt: "2026-09-06T00:00:00Z",
};

/**
 * The whole app with fake edges: a fake socket, a fake IndexedDB and a fake
 * Mermaid renderer. Everything between them is the real machine wiring.
 */
function harness() {
  const store = new Map<string, StudioDocument>([[DOC.id, DOC]]);
  const commands: SocketCommand[] = [];
  let push: ((event: AssistantEvents) => void) | null = null;

  const socket = fromCallback<SocketCommand>(({ sendBack, receive }) => {
    push = (event) => sendBack(event);
    receive((command) => commands.push(command));
    sendBack({ type: "socket.status", status: "connected" });
  });
  const historyLoader = fromPromise<
    { messages: MessageRecord[] | null; tree: TreeNode[]; pending: { toolCallId: string; toolName: string; arguments?: Record<string, unknown> | null } | null },
    { sessionId: string; leafId: string | null }
  >(async () => ({ messages: [], tree: [], pending: null }));
  const treeLoader = fromPromise<TreeNode[], { sessionId: string }>(async () => []);
  const renderer = fromPromise<RenderCache, { codes: string[] }>(async ({ input }) => {
    const cache: RenderCache = {};
    for (const code of input.codes) {
      cache[code] = code.includes("BROKEN")
        ? { ok: false, error: "Parse error on line 2" }
        : { ok: true, svg: "<svg/>" };
    }
    return cache;
  });
  const saver = fromPromise<StudioDocument, { document: StudioDocument }>(async ({ input }) => {
    store.set(input.document.id, input.document);
    return input.document;
  });
  const creator = fromPromise<StudioDocument, { name: string; content: string; sessionId: string }>(
    async ({ input }) => {
      const doc = { id: "new", name: ensureMarkdownName(input.name), content: input.content, sessionId: input.sessionId, updatedAt: "t" };
      store.set(doc.id, doc);
      return doc;
    },
  );
  const finder = fromPromise<StudioDocument | null, { documentId?: string; name?: string; sessionId: string }>(
    async () => null,
  );
  const renamer = fromPromise<StudioDocument | null, { documentId: string; name: string }>(async () => null);
  const loader = fromPromise<StudioDocument[]>(async () => [...store.values()]);

  // The live call: a fake client whose view the test pushes, and a fake runtime for decisions.
  let pushView: ((view: VoiceView) => void) | null = null;
  let view = initialVoiceView();
  const facts: DesignFact[] = [];
  const observe = fromObservable<VoiceView, VoiceClient>(() => ({
    subscribe: (observer) => {
      pushView = typeof observer === "function" ? observer : (value: VoiceView) => observer.next?.(value);
      pushView(view);
      return { unsubscribe: () => undefined };
    },
  }));
  const connect = fromPromise<void, VoiceClient>(async () => undefined);
  const close = fromPromise<void, VoiceClient>(async () => undefined);
  const decisions: Decision[] = [];
  const decisionRequests: DecisionRequest[] = [];
  const receipts: { sessionId: string; result: HostActionResult }[] = [];
  const decider = fromPromise<Decision, DecisionRequest>(async ({ input }) => {
    decisionRequests.push(input);
    const next = decisions.shift();
    if (!next) throw new Error("no decision scripted");
    return next;
  });
  const receipt = fromPromise<void, { sessionId: string; result: HostActionResult }>(async ({ input }) => {
    receipts.push(input);
  });
  const voice = voiceMachine.provide({
    actors: { observe, connect, close },
    actions: {
      forwardFact: ({ event }) => {
        if (event.type === "app.fact") facts.push(event.fact);
      },
    },
  });

  const app = appMachine.provide({
    actors: {
      files: filesMachine.provide({ actors: { loader } }),
      document: documentMachine.provide({ actors: { renderer, saver, creator, finder, renamer } }),
      assistant: assistantMachine.provide({ actors: { socket, historyLoader, treeLoader } }),
      artifacts: artifactsMachine,
      voice,
      designController: designControllerMachine.provide({ actors: { decider, receipt } }),
    },
  });
  const actor = createActor(app);
  actor.start();
  actor.send({ type: "sys.prefsLoaded", theme: "dark", panelOpen: true, lobbySessionId: "lobby-1", designModel: "" });
  const ctx = () => actor.getSnapshot().context;
  return {
    actor,
    commands,
    store,
    server: (event: AssistantEvents) => push?.(event),
    assistant: () => ctx().assistantRef.getSnapshot(),
    document: () => ctx().documentRef.getSnapshot(),
    sends: () => commands.filter((c): c is Extract<SocketCommand, { type: "socket.send" }> => c.type === "socket.send"),
    joins: () => commands.filter((c): c is Extract<SocketCommand, { type: "socket.join" }> => c.type === "socket.join"),
    controller: () => ctx().designRef.getSnapshot(),
    voice: () => ctx().voiceRef.getSnapshot(),
    decisions,
    decisionRequests,
    receipts,
    facts,
    say: (text: string) => {
      const fragments = [...view.fragments, { role: "user" as const, delta: text, start_ms: null, end_ms: null }];
      view = { ...view, callId: "call-1", fragments, lastUserFragment: fragments.length - 1 };
      pushView?.(view);
    },
  };
}

const settle = (ms = 10) => new Promise((r) => setTimeout(r, ms));

function pendingCall(h: ReturnType<typeof harness>, callId: string, toolName: string, args: Record<string, unknown>) {
  h.server({ type: "stream.event", event: { type: "tool_call", id: callId, name: toolName, category: "host", input: args } });
  h.server({
    type: "stream.event",
    event: { type: "final_response", messageId: "m1", model: "m", usage: null, error: null, pendingToolCall: { callId, toolName, arguments: args, queued: [] } },
  });
  h.server({ type: "stream.done" });
}

describe("appMachine", () => {
  it("attaches the lobby session while nothing is open, then the document's session on open", async () => {
    const h = harness();
    await settle();
    expect(h.joins().map((j) => j.sessionId)).toEqual(["lobby-1"]);
    expect(h.joins()[0].hostContext.view?.name).toBe("files");
    h.actor.send({ type: "user.openDocument", id: "d1" });
    await settle();
    expect(h.joins().map((j) => j.sessionId)).toEqual(["lobby-1", "session-d1"]);
    expect(h.joins()[1].hostContext.view?.data?.document).toMatchObject({ id: "d1", name: "payments.md" });
    expect(h.actor.getSnapshot().context.openId).toBe("d1");
    expect(h.document().value).toEqual({ open: "ready" });
  });

  it("routes a replace_block host action through the document machine and back as a continuation", async () => {
    const h = harness();
    await settle();
    h.actor.send({ type: "user.openDocument", id: "d1" });
    await settle();
    h.actor.getSnapshot().context.assistantRef.send({
      type: "user.send",
      text: "make it left to right",
      hostContext: h.joins()[1].hostContext,
    });
    pendingCall(h, "c1", "replace_block", {
      block_id: "b1",
      content: "```mermaid\nflowchart LR\n  API --> Worker --> BROKEN -->\n```",
    });
    expect(h.assistant().value).toBe("awaitingHostAction");
    await settle(30);
    expect(h.assistant().value).toEqual({ streaming: "live" });
    const continuation = h.sends()[1].body;
    expect(continuation).toMatchObject({
      session_id: "session-d1",
      content: "",
      tool_call_id: "c1",
      tool_outcome: "success",
      tool_result: {
        applied: true,
        block_id: "b1",
        render: { ok: false, error: "Parse error on line 2", block_id: "b1" },
      },
    });
    expect(continuation.host_context?.view?.data?.document).toMatchObject({
      selection: "b1",
      blocks: [
        { block_id: "b0", kind: "text" },
        { block_id: "b1", kind: "diagram", render: { ok: false } },
      ],
    });
    expect(h.store.get("d1")?.content).toContain("flowchart LR");
    expect(h.joins()).toHaveLength(2);
  });

  it("create_document from the lobby takes over the lobby session and rotates it", async () => {
    const h = harness();
    await settle();
    h.actor.getSnapshot().context.assistantRef.send({
      type: "user.send",
      text: "design a payment service",
      hostContext: h.joins()[0].hostContext,
    });
    pendingCall(h, "c1", "create_document", {
      name: "payment-service",
      content: "# Payment service\n\n```mermaid\nflowchart TD\n  A --> B\n```\n",
    });
    await settle(30);
    const continuation = h.sends()[1].body;
    expect(continuation).toMatchObject({
      session_id: "lobby-1",
      tool_call_id: "c1",
      tool_outcome: "success",
      tool_result: { document_id: "new", render: { ok: true } },
    });
    expect(h.store.get("new")).toMatchObject({ name: "payment-service.md", sessionId: "lobby-1" });
    expect(h.actor.getSnapshot().context.openId).toBe("new");
    expect(h.actor.getSnapshot().context.lobbySessionId).not.toBe("lobby-1");
    expect(h.assistant().context.sessionId).toBe("lobby-1");
    expect(h.joins()).toHaveLength(1);
  });

  it("attaches the preview screenshot to continuations while a document is open", async () => {
    const h = harness();
    await settle();
    h.actor.send({ type: "user.openDocument", id: "d1" });
    await settle();
    h.actor.send({ type: "sys.screenshot", dataUri: "data:image/jpeg;base64,/9j/" });
    h.actor.getSnapshot().context.assistantRef.send({ type: "user.send", text: "x", hostContext: h.joins()[1].hostContext });
    pendingCall(h, "c1", "delete_block", { block_id: "b1" });
    await settle(30);
    expect(h.sends()[1].body.host_context?.attachments).toEqual([
      expect.objectContaining({ kind: "image", purpose: "screenshot", data_uri: "data:image/jpeg;base64,/9j/" }),
    ]);
  });

  it("answers a failed action with tool_outcome failed", async () => {
    const h = harness();
    await settle();
    h.actor.getSnapshot().context.assistantRef.send({ type: "user.send", text: "x", hostContext: h.joins()[0].hostContext });
    pendingCall(h, "c1", "delete_block", { block_id: "b0" });
    await settle(30);
    expect(h.sends()[1].body).toMatchObject({
      tool_call_id: "c1",
      tool_outcome: "failed",
      tool_result: { error: "no document is open" },
    });
  });

  it("turns a spoken utterance into a document edit through the design controller, not the text chat", async () => {
    const h = harness();
    await settle();
    h.actor.send({ type: "user.openDocument", id: "d1" });
    await settle();
    h.decisions.push({
      kind: "pending",
      model: "cerebras:qwen-3.8-27b",
      action: {
        callId: "design-call-1",
        toolName: "replace_block",
        arguments: { block_id: "b1", content: "```mermaid\nflowchart LR\n  API --> Queue --> Worker\n```" },
        queued: [],
      },
    });
    h.actor.getSnapshot().context.voiceRef.send({ type: "user.start", history: [] });
    await settle();
    expect(h.voice().value).toEqual({ call: "active" });
    expect(h.controller().value).toBe("listening");

    h.say("put a queue between the API and the worker");
    expect(h.controller().value).toBe("waiting");
    await settle(QUIET_MS + 20);
    expect(h.decisionRequests).toHaveLength(1);
    expect(h.decisionRequests[0].hostContext.view?.data?.document).toMatchObject({ id: "d1" });
    expect(h.decisionRequests[0].hostContext.attachments).toBeUndefined();
    await settle(30);

    expect(h.store.get("d1")?.content).toContain("API --> Queue --> Worker");
    expect(h.receipts).toEqual([
      {
        sessionId: h.decisionRequests[0].sessionId,
        result: {
          callId: "design-call-1",
          outcome: "success",
          result: { applied: true, block_id: "b1", render: { ok: true } },
        },
      },
    ]);
    expect(h.facts).toEqual([
      { action: "replace_block", status: "applied", block: "b1", summary: "flowchart LR", render: null },
    ]);
    expect(h.controller().context.decisions[0]).toMatchObject({ status: "applied", action: "replace_block b1" });
    expect(h.controller().context.hostContext?.view?.data?.document).toMatchObject({
      blocks: [{ block_id: "b0" }, { block_id: "b1", render: { ok: true } }],
    });
    // The text assistant saw none of it: no continuation, still idle on its own session.
    expect(h.sends()).toHaveLength(0);
    expect(h.assistant().value).toBe("idle");

    h.actor.getSnapshot().context.voiceRef.send({ type: "user.end" });
    await settle();
    expect(h.controller().value).toBe("idle");
  });

  it("a document created by voice keeps the conversation's session", async () => {
    const h = harness();
    await settle();
    h.decisions.push({
      kind: "pending",
      model: null,
      action: {
        callId: "design-call-2",
        toolName: "create_document",
        arguments: { name: "payments", content: "# Payments\n\n```mermaid\nflowchart TD\n  A --> B\n```\n" },
        queued: [],
      },
    });
    h.actor.getSnapshot().context.voiceRef.send({ type: "user.start", history: [] });
    await settle();
    h.say("design a payment service");
    await settle(QUIET_MS + 50);
    expect(h.store.get("new")).toMatchObject({ name: "payments.md", sessionId: "lobby-1" });
    expect(h.actor.getSnapshot().context.openId).toBe("new");
    expect(h.assistant().context.sessionId).toBe("lobby-1");
    expect(h.receipts[0].result).toMatchObject({ outcome: "success", result: { document_id: "new" } });
  });
});
