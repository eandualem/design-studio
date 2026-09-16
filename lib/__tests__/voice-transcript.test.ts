import { describe, expect, it } from "vitest";
import type { MessageRecord, VoiceFragment } from "@/types";
import { boundConversation, liveMessages, seedHistory, utteranceConversation } from "@/lib/voice-transcript";

const f = (role: "user" | "assistant", delta: string, start?: number, end?: number): VoiceFragment => ({
  role,
  delta,
  start_ms: start ?? null,
  end_ms: end ?? null,
});

describe("liveMessages", () => {
  it("merges consecutive fragments of one speaker and keeps ids stable", () => {
    const fragments = [f("user", "Design a ", 0, 500), f("user", "payment service", 600, 1200), f("assistant", "Sure.", 1300, 1800)];
    expect(liveMessages("c1", fragments)).toEqual([
      { id: "voice:c1:0", role: "user", content: "Design a payment service" },
      { id: "voice:c1:2", role: "assistant", content: "Sure." },
    ]);
  });

  it("starts a new line after an audible gap", () => {
    const fragments = [f("user", "Hello", 0, 400), f("user", "Add a queue", 3000, 3600)];
    expect(liveMessages("c1", fragments).map((m) => m.content)).toEqual(["Hello", "Add a queue"]);
  });
});

describe("utteranceConversation", () => {
  it("is null until the user has spoken", () => {
    expect(utteranceConversation("c1", [f("assistant", "Hi there")])).toBeNull();
    expect(utteranceConversation("c1", [f("user", "   ")])).toBeNull();
  });

  it("keeps one utterance together when Live speaks between its fragments", () => {
    const fragments = [
      f("user", "So the API ", 0, 800),
      f("assistant", "mm-hm", 900, 1000),
      f("user", "talks to a worker", 1100, 1900),
    ];
    const heard = utteranceConversation("c1", fragments);
    expect(heard?.utterance).toBe("So the API talks to a worker");
    expect(heard?.conversation).toEqual([{ role: "user", content: "So the API talks to a worker" }]);
  });

  it("separates utterances by audible gaps and keeps earlier turns as context", () => {
    const fragments = [
      f("user", "Design a payment service", 0, 1500),
      f("assistant", "Sure, what does it need?", 1600, 3000),
      f("user", "Add a queue", 6000, 6500),
    ];
    const heard = utteranceConversation("c1", fragments);
    expect(heard?.utterance).toBe("Add a queue");
    expect(heard?.conversation.map((t) => t.role)).toEqual(["user", "assistant", "user"]);
  });

  it("falls back to adjacency when fragments carry no timings", () => {
    const fragments = [f("user", "Add "), f("user", "a queue")];
    expect(utteranceConversation("c1", fragments)?.utterance).toBe("Add a queue");
  });
});

describe("seedHistory", () => {
  const user = (id: string, text: string, messageType: "standard" | "steering" = "standard"): MessageRecord => ({
    kind: "user",
    id,
    parentId: null,
    text,
    messageType,
    timestamp: "t",
  });
  const assistant = (id: string, text: string): MessageRecord => ({
    kind: "assistant",
    id,
    parentId: null,
    segments: [
      { id: "th", kind: "thinking", block: { text: "hmm" } },
      { id: "tx", kind: "text", text },
      { id: "tg", kind: "tool_group", group: { tools: [] } },
    ],
    isStreaming: false,
    timestamp: "t",
    model: null,
    usage: null,
    error: null,
  });

  it("keeps user and assistant text only, in order", () => {
    expect(seedHistory([user("u1", "Design it"), assistant("a1", "Done."), user("u2", "nudge", "steering")])).toEqual([
      { role: "user", content: "Design it" },
      { role: "assistant", content: "Done." },
    ]);
  });

  it("drops the oldest turns beyond the byte budget", () => {
    const turns = seedHistory([user("u1", "x".repeat(50)), assistant("a1", "y".repeat(50)), user("u2", "z".repeat(50))], 128, 120);
    expect(turns.map((t) => t.content[0])).toEqual(["y", "z"]);
  });
});

describe("boundConversation", () => {
  it("always keeps the latest turn, then as many earlier ones as fit", () => {
    const turns = [
      { role: "user" as const, content: "a".repeat(100) },
      { role: "assistant" as const, content: "b".repeat(100) },
      { role: "user" as const, content: "c".repeat(100) },
    ];
    expect(boundConversation(turns, 150).map((t) => t.content[0])).toEqual(["c"]);
    expect(boundConversation(turns, 250).map((t) => t.content[0])).toEqual(["b", "c"]);
  });
});
