import { describe, expect, it } from "vitest";
import { describeAction, factFromResult } from "@/lib/design-facts";

const action = {
  callId: "c1",
  toolName: "replace_block",
  arguments: { block_id: "b2", content: "```mermaid\nflowchart TD\n  API --> Queue\n```" },
  queued: [],
};

describe("factFromResult", () => {
  it("reports an applied edit with the block and a summary line", () => {
    expect(
      factFromResult(action, { callId: "c1", outcome: "success", result: { applied: true, block_id: "b2", render: { ok: true } } }),
    ).toEqual({ action: "replace_block", status: "applied", block: "b2", summary: "flowchart TD", render: null });
  });

  it("carries a Mermaid parse error as an applied action with a failed render", () => {
    const fact = factFromResult(action, {
      callId: "c1",
      outcome: "success",
      result: { applied: true, block_id: "b2", render: { ok: false, error: "Parse error on line 2", block_id: "b2" } },
    });
    expect(fact.status).toBe("applied");
    expect(fact.render).toBe("Mermaid parse error: Parse error on line 2");
  });

  it("reports a failed action with its error", () => {
    const fact = factFromResult(action, { callId: "c1", outcome: "failed", result: { error: "no such block" } });
    expect(fact).toMatchObject({ status: "failed", render: "no such block" });
  });
});

describe("describeAction", () => {
  it("names the action and its block", () => {
    expect(describeAction(action)).toBe("replace_block b2");
    expect(describeAction({ ...action, toolName: "create_document", arguments: { name: "payments.md", content: "" } })).toBe(
      "create_document payments.md",
    );
  });
});
