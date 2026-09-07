import { describe, expect, it } from "vitest";
import {
  activeLeafId,
  createAssistantMessage,
  finishStreaming,
  foldStreamEvent,
  normalizeStoredMessage,
  sumUsage,
  translateServerEvent,
} from "@/lib/assistant";
import type { MessageRecord, StreamEvent } from "@/types";

function fold(events: StreamEvent[]) {
  return events.reduce(
    (m, e) => foldStreamEvent(m, e),
    createAssistantMessage("u1"),
  );
}

describe("translateServerEvent", () => {
  it("maps status, deltas and tool events from the documented shapes", () => {
    expect(translateServerEvent("status", { status: "started" })).toEqual({
      type: "status",
      status: "started",
    });
    expect(
      translateServerEvent("text_delta", {
        content: "hi",
        segment_id: "s1",
        segment_kind: "text",
      }),
    ).toEqual({ type: "text_delta", text: "hi" });
    expect(
      translateServerEvent("tool_call", {
        tool_name: "replace_block",
        arguments: '{"block_id":"b1"}',
        call_id: "c1",
        category: "host",
      }),
    ).toEqual({
      type: "tool_call",
      id: "c1",
      name: "replace_block",
      category: "host",
      input: { block_id: "b1" },
    });
    expect(
      translateServerEvent("tool_result", {
        tool_name: "get_time",
        output: { now: "x" },
        call_id: "c2",
        duration_ms: 12,
      }),
    ).toEqual({
      type: "tool_result",
      id: "c2",
      output: { now: "x" },
      duration_ms: 12,
    });
  });

  it("maps final_response with usage, error and pending_tool_call", () => {
    const ev = translateServerEvent("final_response", {
      content: "done",
      model: "anthropic:claude-opus-5",
      streamed: true,
      message_id: "m9",
      usage: { input_tokens: 10, output_tokens: 5, cost_usd: 0.01 },
      pending_tool_call: {
        tool_name: "create_document",
        call_id: "c3",
        arguments: { name: "a.md", content: "# a" },
        queued: ["c4", "c5"],
      },
    });
    expect(ev).toMatchObject({
      type: "final_response",
      messageId: "m9",
      model: "anthropic:claude-opus-5",
      error: null,
      pendingToolCall: {
        callId: "c3",
        toolName: "create_document",
        arguments: { name: "a.md", content: "# a" },
        queued: ["c4", "c5"],
      },
    });
    const errored = translateServerEvent("final_response", {
      content: null,
      model: "unknown",
      streamed: false,
      error: true,
      error_type: "setup_error",
    });
    expect(errored).toMatchObject({
      type: "final_response",
      error: { errorType: "setup_error" },
      pendingToolCall: null,
    });
  });

  it("maps assistant:error and rejects malformed payloads", () => {
    expect(
      translateServerEvent("error", {
        type: "error",
        message: "boom",
        error_type: "cancelled",
        terminal: true,
      }),
    ).toEqual({
      type: "error",
      message: "boom",
      errorType: "cancelled",
      terminal: true,
      retryAllowed: true,
    });
    expect(translateServerEvent("tool_call", { nope: 1 })).toBeNull();
    expect(translateServerEvent("status", { status: "weird" })).toBeNull();
  });
});

describe("foldStreamEvent", () => {
  it("groups consecutive tool calls and splits groups on text", () => {
    const msg = fold([
      { type: "thinking_delta", text: "let me " },
      { type: "thinking_delta", text: "think" },
      { type: "tool_call", id: "a", name: "get_time", category: "backend", input: {} },
      { type: "tool_call", id: "b", name: "look_at_screen", category: "backend", input: {} },
      { type: "tool_result", id: "a", output: "12:00", duration_ms: 3 },
      { type: "text_delta", text: "Hello" },
      { type: "text_delta", text: " there" },
      { type: "tool_call", id: "c", name: "replace_block", category: "host", input: { block_id: "b1" } },
    ]);
    expect(msg.segments.map((s) => s.kind)).toEqual([
      "thinking",
      "tool_group",
      "text",
      "tool_group",
    ]);
    const first = msg.segments[1];
    if (first.kind !== "tool_group") throw new Error("expected tool group");
    expect(first.group.tools.map((t) => [t.id, t.status])).toEqual([
      ["a", "completed"],
      ["b", "running"],
    ]);
    expect(msg.segments[0]).toMatchObject({ block: { text: "let me think" } });
    expect(msg.segments[2]).toMatchObject({ text: "Hello there" });
  });

  it("does not downgrade a completed tool when its call is echoed", () => {
    const msg = fold([
      { type: "tool_call", id: "a", name: "get_time", category: "backend", input: {} },
      { type: "tool_result", id: "a", output: "x" },
      { type: "tool_call", id: "a", name: "get_time", category: "backend", input: {} },
    ]);
    const group = msg.segments[0];
    if (group.kind !== "tool_group") throw new Error("expected tool group");
    expect(group.group.tools).toHaveLength(1);
    expect(group.group.tools[0].status).toBe("completed");
  });

  it("applies final_response metadata and keeps the stream open until done", () => {
    const msg = fold([
      { type: "text_delta", text: "Hi" },
      {
        type: "final_response",
        messageId: "m1",
        model: "m",
        usage: { input_tokens: 1, output_tokens: 2 },
        error: null,
        pendingToolCall: null,
      },
    ]);
    expect(msg.id).toBe("m1");
    expect(msg.usage).toEqual({ input_tokens: 1, output_tokens: 2 });
    expect(msg.isStreaming).toBe(true);
    expect(finishStreaming(msg).isStreaming).toBe(false);
  });

  it("marks orphaned running tools as errors when the stream ends", () => {
    const msg = finishStreaming(
      fold([{ type: "tool_call", id: "a", name: "x", category: "backend", input: {} }]),
    );
    const group = msg.segments[0];
    if (group.kind !== "tool_group") throw new Error("expected tool group");
    expect(group.group.tools[0].status).toBe("error");
  });

  it("records a terminal error on the message", () => {
    const msg = fold([
      { type: "text_delta", text: "partial" },
      { type: "error", message: "Cancelled by user", errorType: "cancelled", terminal: true, retryAllowed: true },
    ]);
    expect(msg.isStreaming).toBe(false);
    expect(msg.error).toEqual({ errorType: "cancelled", message: "Cancelled by user", retryAllowed: true });
    expect(msg.segments[0]).toMatchObject({ text: "partial" });
  });
});

describe("normalizeStoredMessage", () => {
  const hostNames = new Set(["replace_block", "create_document"]);

  it("converts the user row shape", () => {
    const rec = normalizeStoredMessage(
      {
        id: "u1",
        parent_id: null,
        role: "user",
        text: "hello",
        message_type: "standard",
        timestamp: "2026-09-06T09:47:35+00:00",
      },
      hostNames,
    );
    expect(rec).toEqual({
      kind: "user",
      id: "u1",
      parentId: null,
      text: "hello",
      messageType: "standard",
      timestamp: "2026-09-06T09:47:35+00:00",
    });
  });

  it("converts assistant segments, classifying host tools by name and outcomes by status", () => {
    const rec = normalizeStoredMessage(
      {
        id: "a1",
        parent_id: "u1",
        role: "assistant",
        text: "done",
        segments: [
          { kind: "thinking", text: "hm", segment_id: "segment_0", segment_index: 0 },
          { kind: "text", text: "done", segment_id: "segment_1", segment_index: 1 },
          {
            kind: "tool_group",
            segment_id: "segment_2",
            segment_index: 2,
            tools: [
              { id: "c1", name: "replace_block", input: { block_id: "b" }, output: { applied: true } },
              { id: "c2", name: "get_time", input: {}, output: "12:00" },
              { id: "c3", name: "create_document", input: {}, outcome: "interrupted", status: "unknown" },
              { id: "c4", name: "create_document", input: {}, output: { error: "x" }, outcome: "failed", status: "failed" },
            ],
          },
        ],
        usage: { input_tokens: 3, output_tokens: 4, cost_usd: null },
        timestamp: "t",
      },
      hostNames,
    );
    if (rec.kind !== "assistant") throw new Error("expected assistant");
    expect(rec.segments.map((s) => [s.kind, s.id])).toEqual([
      ["thinking", "segment_0"],
      ["text", "segment_1"],
      ["tool_group", "segment_2"],
    ]);
    const group = rec.segments[2];
    if (group.kind !== "tool_group") throw new Error("expected tool group");
    expect(group.group.tools.map((t) => [t.category, t.status])).toEqual([
      ["host", "completed"],
      ["backend", "completed"],
      ["host", "error"],
      ["host", "error"],
    ]);
    expect(rec.usage).toMatchObject({ input_tokens: 3 });
  });

  it("turns a delivered steering row into a steering user record", () => {
    const rec = normalizeStoredMessage(
      { id: "s1", role: "steering", text: "use British spelling", message_type: "steering", status: "delivered", timestamp: "t" },
      hostNames,
    );
    expect(rec).toMatchObject({ kind: "user", messageType: "steering", parentId: null });
  });
});

describe("activeLeafId", () => {
  it("returns the last displayed message the runtime stored, skipping steering and placeholders", () => {
    const messages: MessageRecord[] = [
      { kind: "user", id: "u1", parentId: null, text: "a", messageType: "standard", timestamp: "t" },
      { kind: "user", id: "s1", parentId: null, text: "nudge", messageType: "steering", timestamp: "t" },
      createAssistantMessage("u1", "placeholder"),
    ];
    expect(activeLeafId(messages, [])).toBeNull();
    expect(activeLeafId(messages, [{ id: "u1" }])).toBe("u1");
    expect(activeLeafId(messages, [{ id: "u1" }, { id: "s1" }])).toBe("u1");
    expect(activeLeafId(messages, [{ id: "u1" }, { id: "placeholder" }])).toBe("placeholder");
  });
});

describe("sumUsage", () => {
  it("sums the latest usage per assistant record and keeps cost null when unpriced", () => {
    const a = createAssistantMessage("u1", "a1");
    const b = createAssistantMessage("u2", "a2");
    const msgs: MessageRecord[] = [
      { ...a, usage: { input_tokens: 5, output_tokens: 6, cost_usd: null } },
      { ...b, usage: { input_tokens: 1, output_tokens: 1, cost_usd: 0.5 } },
    ];
    expect(sumUsage(msgs.slice(0, 1))).toEqual({ inputTokens: 5, outputTokens: 6, costUsd: null, turns: 1 });
    expect(sumUsage(msgs)).toEqual({ inputTokens: 6, outputTokens: 7, costUsd: 0.5, turns: 2 });
  });
});
