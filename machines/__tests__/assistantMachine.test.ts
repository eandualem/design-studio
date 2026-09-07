import { describe, expect, it } from "vitest";
import { createActor, fromCallback, fromPromise, setup, type ActorRefFrom } from "xstate";
import {
  assistantMachine,
  type AssistantEvents,
  type SocketCommand,
} from "@/machines/assistantMachine";
import type { HostContext, MessageRecord, TreeNode } from "@/types";

const hostContext: HostContext = {
  version: 1,
  host: { name: "design-studio", kind: "browser", version: "test" },
  view: { name: "files", data: { documents: [] } },
  captured_at: "2026-09-06T00:00:00Z",
};

function harness(history: MessageRecord[] = [], tree: TreeNode[] = []) {
  const commands: SocketCommand[] = [];
  const loads: (string | null)[] = [];
  let push: ((event: AssistantEvents) => void) | null = null;
  const socket = fromCallback<SocketCommand>(({ sendBack, receive }) => {
    push = (event) => sendBack(event);
    receive((command) => commands.push(command));
    sendBack({ type: "socket.status", status: "connected" });
  });
  const historyLoader = fromPromise<
    { messages: MessageRecord[] | null; tree: TreeNode[]; pending: { toolCallId: string; toolName: string } | null },
    { sessionId: string; leafId: string | null }
  >(async ({ input }) => {
    loads.push(input.leafId);
    if (input.leafId === "missing") return { messages: null, tree, pending: null };
    return { messages: history, tree, pending: pendingRef.current };
  });
  const treeRef = { current: tree };
  const pendingRef = {
    current: null as { toolCallId: string; toolName: string; arguments?: Record<string, unknown> | null } | null,
  };
  const repairs: string[] = [];
  const repairer = fromPromise<void, { sessionId: string }>(async ({ input }) => {
    repairs.push(input.sessionId);
    pendingRef.current = null;
  });
  const treeLoader = fromPromise<TreeNode[], { sessionId: string }>(async () => treeRef.current);
  const emitted: unknown[] = [];
  const parent = createActor(
    setup({
      actors: {
        assistant: assistantMachine.provide({ actors: { socket, historyLoader, treeLoader, repairer } }),
      },
    }).createMachine({
      invoke: { id: "assistant", src: "assistant", systemId: "assistant" },
      on: { "assistant.hostAction": { actions: ({ event }) => emitted.push(event) } },
    }),
  );
  parent.start();
  const actor = parent.system.get("assistant") as ActorRefFrom<typeof assistantMachine>;
  return {
    actor,
    commands,
    emitted,
    loads,
    setTree: (nodes: TreeNode[]) => {
      treeRef.current = nodes;
    },
    setPending: (p: { toolCallId: string; toolName: string; arguments?: Record<string, unknown> | null } | null) => {
      pendingRef.current = p;
    },
    repairs,
    server: (event: AssistantEvents) => push?.(event),
    lastAssistant() {
      const msgs = actor.getSnapshot().context.messages;
      const last = msgs[msgs.length - 1];
      if (!last || last.kind !== "assistant") throw new Error("no assistant message");
      return last;
    },
  };
}

async function tick() {
  await new Promise((r) => setTimeout(r, 0));
}

describe("assistantMachine", () => {
  it("joins the session, loads history and accepts a message", async () => {
    const h = harness(
      [{ kind: "user", id: "u0", parentId: null, text: "old", messageType: "standard", timestamp: "t" }],
      [{ id: "u0", parent_id: null, role: "user", created_at: "1" }],
    );
    h.actor.send({ type: "app.session", sessionId: "s1", hostContext });
    expect(h.commands[0]).toMatchObject({ type: "socket.join", sessionId: "s1" });
    await tick();
    expect(h.actor.getSnapshot().value).toBe("idle");
    expect(h.actor.getSnapshot().context.messages).toHaveLength(1);
    expect(h.actor.getSnapshot().context.connection).toBe("connected");

    h.actor.send({ type: "user.send", text: "hello", hostContext });
    expect(h.actor.getSnapshot().value).toEqual({ streaming: "live" });
    const sent = h.commands[1];
    if (sent.type !== "socket.send") throw new Error("expected send");
    expect(sent.body).toMatchObject({
      session_id: "s1",
      content: "hello",
      message_type: "standard",
      host_context: hostContext,
    });
    const msgs = h.actor.getSnapshot().context.messages;
    expect(msgs.map((m) => m.kind)).toEqual(["user", "user", "assistant"]);
    expect(msgs[1]).toMatchObject({ id: sent.body.id, parentId: "u0" });
  });

  it("ignores user.send before a session is attached", () => {
    const h = harness();
    h.actor.send({ type: "user.send", text: "hello", hostContext });
    expect(h.actor.getSnapshot().value).toBe("idle");
    expect(h.commands).toHaveLength(0);
  });

  it("folds a full turn and returns to idle with usage totals", async () => {
    const h = harness();
    h.actor.send({ type: "app.session", sessionId: "s1", hostContext });
    await tick();
    h.actor.send({ type: "user.send", text: "hi", hostContext });
    h.server({ type: "stream.event", event: { type: "status", status: "started" } });
    h.server({ type: "stream.event", event: { type: "thinking_delta", text: "hm" } });
    h.server({ type: "stream.event", event: { type: "text_delta", text: "Hello" } });
    h.server({
      type: "stream.event",
      event: {
        type: "final_response",
        messageId: "m1",
        model: "anthropic:claude-opus-5",
        usage: { input_tokens: 10, output_tokens: 4, cost_usd: 0.02 },
        error: null,
        pendingToolCall: null,
      },
    });
    expect(h.actor.getSnapshot().value).toEqual({ streaming: "live" });
    h.server({ type: "stream.done" });
    expect(h.actor.getSnapshot().value).toBe("syncingTree");
    await tick();
    expect(h.actor.getSnapshot().value).toBe("idle");
    const last = h.lastAssistant();
    expect(last.id).toBe("m1");
    expect(last.isStreaming).toBe(false);
    expect(last.segments.map((s) => s.kind)).toEqual(["thinking", "text"]);
    expect(h.actor.getSnapshot().context.totals).toEqual({
      inputTokens: 10,
      outputTokens: 4,
      costUsd: 0.02,
      turns: 1,
    });
  });

  it("pauses on a pending host action and sends the continuation", async () => {
    const h = harness();
    h.actor.send({ type: "app.session", sessionId: "s1", hostContext });
    await tick();
    h.actor.send({ type: "user.send", text: "make a doc", hostContext });
    h.server({
      type: "stream.event",
      event: {
        type: "tool_call",
        id: "c1",
        name: "create_document",
        category: "host",
        input: { name: "a.md", content: "# a" },
      },
    });
    h.server({
      type: "stream.event",
      event: {
        type: "final_response",
        messageId: "m1",
        model: "m",
        usage: { input_tokens: 30, output_tokens: 10, cost_usd: 0.02 },
        error: null,
        pendingToolCall: {
          callId: "c1",
          toolName: "create_document",
          arguments: { name: "a.md", content: "# a" },
          queued: [],
        },
      },
    });
    expect(h.emitted).toHaveLength(0);
    h.server({ type: "stream.done" });
    expect(h.actor.getSnapshot().value).toBe("awaitingHostAction");
    expect(h.emitted).toHaveLength(1);
    expect(h.emitted[0]).toMatchObject({
      type: "assistant.hostAction",
      action: { callId: "c1", toolName: "create_document" },
    });
    expect(h.lastAssistant().isStreaming).toBe(false);

    h.actor.send({
      type: "host.actionResult",
      callId: "c1",
      result: { document_id: "d1", blocks: [], render: { ok: true } },
      outcome: "success",
      hostContext,
    });
    expect(h.actor.getSnapshot().value).toEqual({ streaming: "live" });
    const cont = h.commands[h.commands.length - 1];
    if (cont.type !== "socket.send") throw new Error("expected send");
    expect(cont.body).toMatchObject({
      session_id: "s1",
      content: "",
      tool_call_id: "c1",
      tool_result: { document_id: "d1" },
      tool_outcome: "success",
      host_context: hostContext,
    });
    const group = h.lastAssistant().segments[0];
    if (group.kind !== "tool_group") throw new Error("expected tool group");
    expect(group.group.tools[0].status).toBe("completed");
    expect(h.actor.getSnapshot().context.pendingAction).toBeNull();

    h.server({ type: "stream.event", event: { type: "text_delta", text: "Created." } });
    h.server({ type: "stream.event", event: { type: "final_response", messageId: "m1", model: "m", usage: { input_tokens: 70, output_tokens: 30, cost_usd: 0.04 }, error: null, pendingToolCall: null } });
    h.server({ type: "stream.done" });
    await tick();
    expect(h.actor.getSnapshot().value).toBe("idle");
    expect(h.actor.getSnapshot().context.messages).toHaveLength(2);
    expect(h.actor.getSnapshot().context.totals).toEqual({ inputTokens: 70, outputTokens: 30, costUsd: 0.04, turns: 1 });
  });

  it("handles queued host actions handed over one continuation at a time", async () => {
    const h = harness();
    h.actor.send({ type: "app.session", sessionId: "s1", hostContext });
    await tick();
    h.actor.send({ type: "user.send", text: "change both diagrams", hostContext });
    h.server({ type: "stream.event", event: { type: "tool_call", id: "c1", name: "replace_block", category: "host", input: { block_id: "b1", content: "x" } } });
    h.server({ type: "stream.event", event: { type: "tool_call", id: "c2", name: "replace_block", category: "host", input: { block_id: "b2", content: "y" } } });
    h.server({ type: "stream.event", event: { type: "final_response", messageId: "m1", model: "m", usage: null, error: null, pendingToolCall: { callId: "c1", toolName: "replace_block", arguments: { block_id: "b1", content: "x" }, queued: ["c2"] } } });
    h.server({ type: "stream.done" });
    expect(h.actor.getSnapshot().value).toBe("awaitingHostAction");
    expect(h.actor.getSnapshot().context.pendingAction?.queued).toEqual(["c2"]);
    h.actor.send({ type: "host.actionResult", callId: "c1", result: { applied: true }, outcome: "success", hostContext });
    h.server({ type: "stream.event", event: { type: "final_response", messageId: "m1", model: "m", usage: null, error: null, pendingToolCall: { callId: "c2", toolName: "replace_block", arguments: { block_id: "b2", content: "y" }, queued: [] } } });
    h.server({ type: "stream.done" });
    expect(h.actor.getSnapshot().value).toBe("awaitingHostAction");
    expect(h.emitted.map((e) => (e as { action: { callId: string } }).action.callId)).toEqual(["c1", "c2"]);
    h.actor.send({ type: "host.actionResult", callId: "c2", result: { applied: true }, outcome: "success", hostContext });
    const sends = h.commands.filter((c) => c.type === "socket.send");
    expect(sends.map((c) => (c.type === "socket.send" ? c.body.tool_call_id : null))).toEqual([undefined, "c1", "c2"]);
  });

  it("marks a failed host action on the tool card and reports tool_outcome failed", async () => {
    const h = harness();
    h.actor.send({ type: "app.session", sessionId: "s1", hostContext });
    await tick();
    h.actor.send({ type: "user.send", text: "x", hostContext });
    h.server({ type: "stream.event", event: { type: "tool_call", id: "c1", name: "delete_block", category: "host", input: { block_id: "nope" } } });
    h.server({ type: "stream.event", event: { type: "final_response", messageId: "m1", model: "m", usage: null, error: null, pendingToolCall: { callId: "c1", toolName: "delete_block", arguments: { block_id: "nope" }, queued: [] } } });
    h.server({ type: "stream.done" });
    h.actor.send({ type: "host.actionResult", callId: "c1", result: { error: "unknown block id" }, outcome: "failed", hostContext });
    const cont = h.commands[h.commands.length - 1];
    if (cont.type !== "socket.send") throw new Error("expected send");
    expect(cont.body.tool_outcome).toBe("failed");
    const group = h.lastAssistant().segments[0];
    if (group.kind !== "tool_group") throw new Error("expected tool group");
    expect(group.group.tools[0].status).toBe("error");
  });

  it("cancel keeps the partial text and ends on the runtime's cancelled outcome", async () => {
    const h = harness();
    h.actor.send({ type: "app.session", sessionId: "s1", hostContext });
    await tick();
    h.actor.send({ type: "user.send", text: "long", hostContext });
    h.server({ type: "stream.event", event: { type: "text_delta", text: "partial" } });
    h.actor.send({ type: "user.cancel" });
    expect(h.actor.getSnapshot().value).toEqual({ streaming: "cancelling" });
    expect(h.commands[h.commands.length - 1]).toEqual({ type: "socket.cancel", sessionId: "s1" });
    h.server({ type: "stream.event", event: { type: "final_response", messageId: "m1", model: "m", usage: null, error: { errorType: "cancelled", message: null }, pendingToolCall: null } });
    h.server({ type: "stream.event", event: { type: "error", message: "Cancelled", errorType: "cancelled", terminal: true, retryAllowed: true } });
    expect(h.actor.getSnapshot().value).toBe("syncingTree");
    h.server({ type: "stream.done" });
    await tick();
    expect(h.actor.getSnapshot().value).toBe("idle");
    const last = h.lastAssistant();
    expect(last.segments[0]).toMatchObject({ text: "partial" });
    expect(last.error).toEqual({ errorType: "cancelled", message: "Cancelled", retryAllowed: true });
    expect(last.isStreaming).toBe(false);
  });

  it("ends the turn on a terminal runtime error such as setup_error", async () => {
    const h = harness();
    h.actor.send({ type: "app.session", sessionId: "s1", hostContext });
    await tick();
    h.actor.send({ type: "user.send", text: "hi", hostContext });
    h.server({ type: "stream.event", event: { type: "status", status: "started" } });
    h.server({ type: "stream.event", event: { type: "final_response", messageId: null, model: "unknown", usage: null, error: { errorType: "setup_error", message: null }, pendingToolCall: null } });
    h.server({ type: "stream.event", event: { type: "error", message: "Setup failed: no key", errorType: "setup_error", terminal: true, retryAllowed: true } });
    await tick();
    expect(h.actor.getSnapshot().value).toBe("idle");
    expect(h.lastAssistant().error).toEqual({ errorType: "setup_error", message: "Setup failed: no key", retryAllowed: true });
  });

  it("sends parent_id and attachments, and branches from an earlier message", async () => {
    const h = harness(
      [
        { kind: "user", id: "u1", parentId: null, text: "first", messageType: "standard", timestamp: "t" },
        { kind: "assistant", id: "a1", parentId: "u1", segments: [], isStreaming: false, timestamp: "t", model: null, usage: null, error: null },
      ],
      [
        { id: "u1", parent_id: null, role: "user", created_at: "1" },
        { id: "a1", parent_id: "u1", role: "assistant", created_at: "2" },
      ],
    );
    h.actor.send({ type: "app.session", sessionId: "s1", hostContext });
    await tick();
    h.actor.send({
      type: "user.send",
      text: "next",
      hostContext,
      attachments: [{ kind: "image", purpose: "reference", name: "photo.png", data_uri: "data:image/png;base64,AA==" }],
      previews: [{ name: "photo.png", dataUri: "data:image/png;base64,AA==" }],
    });
    const first = h.commands[1];
    if (first.type !== "socket.send") throw new Error("expected send");
    expect(first.body.parent_id).toBe("a1");
    expect(first.body.attachments).toHaveLength(1);
    const user = h.actor.getSnapshot().context.messages[2];
    expect(user).toMatchObject({ kind: "user", parentId: "a1", attachments: [{ name: "photo.png" }] });
    h.server({ type: "stream.event", event: { type: "final_response", messageId: "a2", model: "m", usage: null, error: null, pendingToolCall: null } });
    h.server({ type: "stream.done" });
    await tick();
    expect(h.actor.getSnapshot().value).toBe("idle");

    h.actor.send({ type: "user.send", text: "variant of first", hostContext, parentId: null });
    const branch = h.commands[2];
    if (branch.type !== "socket.send") throw new Error("expected send");
    expect(branch.body.parent_id).toBeUndefined();
    const msgs = h.actor.getSnapshot().context.messages;
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ kind: "user", text: "variant of first", parentId: null });
  });

  it("loads another branch by leaf id when a variant is selected", async () => {
    const h = harness();
    h.actor.send({ type: "app.session", sessionId: "s1", hostContext });
    await tick();
    h.actor.send({ type: "user.selectVariant", leafId: "a2b" });
    expect(h.actor.getSnapshot().value).toBe("loadingHistory");
    await tick();
    expect(h.loads).toEqual([null, "a2b"]);
    expect(h.actor.getSnapshot().value).toBe("idle");
  });

  it("keeps the transcript when the requested leaf is unknown to the runtime", async () => {
    const h = harness([
      { kind: "user", id: "u1", parentId: null, text: "first", messageType: "standard", timestamp: "t" },
    ]);
    h.actor.send({ type: "app.session", sessionId: "s1", hostContext });
    await tick();
    h.actor.send({ type: "user.selectVariant", leafId: "missing" });
    await tick();
    expect(h.actor.getSnapshot().context.messages).toHaveLength(1);
    expect(h.actor.getSnapshot().context.error).toMatch(/not stored/);
    expect(h.actor.getSnapshot().context.leafId).toBeNull();
  });

  it("after a failed turn the next message continues from the last stored message, not the placeholder", async () => {
    const h = harness();
    h.actor.send({ type: "app.session", sessionId: "s1", hostContext });
    await tick();
    h.actor.send({ type: "user.send", text: "first", hostContext });
    const first = h.commands[h.commands.length - 1];
    if (first.type !== "socket.send") throw new Error("expected send");
    h.setTree([{ id: first.body.id, parent_id: null, role: "user", created_at: "1" }]);
    h.server({ type: "stream.event", event: { type: "final_response", messageId: null, model: "unknown", usage: null, error: { errorType: "setup_error", message: null }, pendingToolCall: null } });
    h.server({ type: "stream.event", event: { type: "error", message: "Setup failed", errorType: "setup_error", terminal: true, retryAllowed: true } });
    await tick();
    h.actor.send({ type: "user.send", text: "second", hostContext });
    const second = h.commands[h.commands.length - 1];
    if (second.type !== "socket.send") throw new Error("expected send");
    expect(second.body.parent_id).toBe(first.body.id);
  });

  it("sends a steering nudge mid-stream without changing state", async () => {
    const h = harness();
    h.actor.send({ type: "app.session", sessionId: "s1", hostContext });
    await tick();
    h.actor.send({ type: "user.send", text: "write", hostContext });
    h.server({ type: "stream.event", event: { type: "text_delta", text: "Colour" } });
    h.actor.send({ type: "user.steer", text: "use British spelling" });
    expect(h.actor.getSnapshot().value).toEqual({ streaming: "live" });
    const steer = h.commands[h.commands.length - 1];
    if (steer.type !== "socket.send") throw new Error("expected send");
    expect(steer.body).toMatchObject({ session_id: "s1", content: "use British spelling", message_type: "steering" });
    expect(steer.body.parent_id).toBeUndefined();
    const msgs = h.actor.getSnapshot().context.messages;
    expect(msgs.map((m) => (m.kind === "user" ? m.messageType : "assistant"))).toEqual(["standard", "steering", "assistant"]);
    expect(h.lastAssistant().segments[0]).toMatchObject({ text: "Colour" });
  });

  it("recovers a pending host action from the stored transcript after a reload", async () => {
    const h = harness([
      { kind: "user", id: "u1", parentId: null, text: "make a doc", messageType: "standard", timestamp: "t" },
      {
        kind: "assistant",
        id: "a1",
        parentId: "u1",
        segments: [
          {
            id: "segment_0",
            kind: "tool_group",
            group: { tools: [{ id: "c9", name: "create_document", category: "host", input: { name: "x.md", content: "# x" }, status: "running" }] },
          },
        ],
        isStreaming: false,
        timestamp: "t",
        model: null,
        usage: null,
        error: null,
      },
    ]);
    h.setPending({ toolCallId: "c9", toolName: "create_document" });
    h.actor.send({ type: "app.session", sessionId: "s1", hostContext });
    await tick();
    expect(h.actor.getSnapshot().value).toBe("awaitingHostAction");
    expect(h.emitted[0]).toMatchObject({
      type: "assistant.hostAction",
      action: { callId: "c9", toolName: "create_document", arguments: { name: "x.md", content: "# x" } },
    });
    h.actor.send({ type: "host.actionResult", callId: "c9", result: { document_id: "d" }, outcome: "success", hostContext });
    const cont = h.commands[h.commands.length - 1];
    if (cont.type !== "socket.send") throw new Error("expected send");
    expect(cont.body).toMatchObject({ tool_call_id: "c9", tool_outcome: "success" });
  });

  it("uses pending_action.arguments from the session detail when the runtime sends them", async () => {
    const h = harness([
      { kind: "user", id: "u1", parentId: null, text: "x", messageType: "standard", timestamp: "t" } as MessageRecord,
    ]);
    h.setPending({ toolCallId: "c1", toolName: "delete_block", arguments: { block_id: "b2" } });
    h.actor.send({ type: "app.session", sessionId: "s1", hostContext });
    await tick();
    expect(h.actor.getSnapshot().value).toBe("awaitingHostAction");
    expect(h.emitted[0]).toMatchObject({ action: { callId: "c1", toolName: "delete_block", arguments: { block_id: "b2" } } });
  });

  it("offers a repair when the pending action's call is not in the transcript", async () => {
    const h = harness([
      { kind: "user", id: "u1", parentId: null, text: "x", messageType: "standard", timestamp: "t" },
    ]);
    h.setPending({ toolCallId: "gone", toolName: "replace_block" });
    h.actor.send({ type: "app.session", sessionId: "s1", hostContext });
    await tick();
    expect(h.actor.getSnapshot().value).toBe("needsRepair");
    h.actor.send({ type: "user.repair" });
    expect(h.actor.getSnapshot().value).toBe("repairing");
    await tick();
    await tick();
    expect(h.repairs).toEqual(["s1"]);
    expect(h.actor.getSnapshot().value).toBe("idle");
  });

  it("reloads history when the transport reconnects mid-turn", async () => {
    const h = harness();
    h.actor.send({ type: "app.session", sessionId: "s1", hostContext });
    await tick();
    h.actor.send({ type: "user.send", text: "hi", hostContext });
    h.server({ type: "socket.reconnected" });
    expect(h.actor.getSnapshot().value).toBe("loadingHistory");
    await tick();
    expect(h.actor.getSnapshot().value).toBe("idle");
  });
});
