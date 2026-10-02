import { afterEach, expect, it, vi } from "vitest";
import { fetchSessionDetail } from "@/lib/runtime-api";

afterEach(() => vi.unstubAllGlobals());

it("loads pending action arguments from the runtime and rejects an incomplete action", async () => {
  const pending = {
    tool_call_id: "c1",
    tool_name: "replace_block",
    arguments: { block_id: "b1", content: "Updated" },
    queued: ["c2"],
  };
  const fetcher = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ session_id: "s1", pending_action: pending })),
  );
  vi.stubGlobal("fetch", fetcher);
  expect((await fetchSessionDetail("s1")).pending_action).toEqual(pending);

  fetcher.mockResolvedValue(new Response(JSON.stringify({
    session_id: "s1",
    pending_action: { tool_call_id: "c1", tool_name: "replace_block" },
  })));
  await expect(fetchSessionDetail("s1")).rejects.toThrow("arguments");
});
