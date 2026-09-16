import { afterEach, describe, expect, it, vi } from "vitest";
import { decide, sendReceipt } from "@/lib/design-runtime";
import type { HostContext } from "@/types";

const hostContext: HostContext = {
  version: 1,
  host: { name: "design-studio", kind: "browser", version: "test" },
  view: { name: "files", data: { documents: [] } },
  captured_at: "t",
};

function fakeFetch(reply: unknown) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(reply), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  return calls;
}

describe("design-runtime", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends a silent decision with the profile, the conversation and the chosen model", async () => {
    const calls = fakeFetch({
      content: null,
      decision: "pending",
      model: "cerebras:qwen-3.8-27b",
      pending_tool_call: { tool_name: "delete_block", call_id: "c1", arguments: '{"block_id":"b1"}' },
    });
    const decision = await decide(
      {
        sessionId: "design-1",
        conversation: [{ role: "user", content: "drop the worker" }],
        hostContext,
        model: "cerebras:qwen-3.8-27b",
      },
      new AbortController().signal,
    );
    expect(decision).toEqual({
      kind: "pending",
      model: "cerebras:qwen-3.8-27b",
      action: { callId: "c1", toolName: "delete_block", arguments: { block_id: "b1" }, queued: [] },
    });
    expect(calls[0].url).toMatch(/\/api\/chat$/);
    expect(calls[0].body).toMatchObject({
      session_id: "design-1",
      profile: "design_studio",
      output_mode: "host_tools",
      host_context: hostContext,
      config: { thinking_budget: 4000, enable_working_memory: false, default_model: "cerebras:qwen-3.8-27b" },
    });
    expect(String(calls[0].body.content)).toContain("User: drop the worker");
    expect(String(calls[0].body.content)).toContain("Design controller");
  });

  it("treats hold as no change and the runtime default as no model", async () => {
    const calls = fakeFetch({ content: null, decision: "hold", model: "openai:gpt-5.6-sol" });
    const decision = await decide(
      { sessionId: "design-2", conversation: [{ role: "user", content: "hello" }], hostContext, model: "" },
      new AbortController().signal,
    );
    expect(decision).toEqual({ kind: "hold", model: "openai:gpt-5.6-sol" });
    expect((calls[0].body.config as Record<string, unknown>).default_model).toBeUndefined();
  });

  it("receipts on the decision session with the profile and expects a silent completion", async () => {
    const calls = fakeFetch({ content: null, decision: "completed" });
    await sendReceipt(
      "design-1",
      { callId: "c1", outcome: "success", result: { applied: true } },
      new AbortController().signal,
    );
    expect(calls[0].body).toMatchObject({
      session_id: "design-1",
      profile: "design_studio",
      output_mode: "host_tools",
      content: "",
      tool_call_id: "c1",
      tool_result: { applied: true },
      tool_outcome: "success",
    });
    fakeFetch({ content: "I changed it!", decision: "completed" });
    await expect(
      sendReceipt("design-1", { callId: "c1", outcome: "success", result: {} }, new AbortController().signal),
    ).rejects.toThrow("did not complete silently");
  });
});
