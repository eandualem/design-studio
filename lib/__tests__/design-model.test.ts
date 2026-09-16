import { describe, expect, it } from "vitest";
import { designModelConfig, normalizeDesignModel } from "@/lib/design-model";

describe("normalizeDesignModel", () => {
  it("accepts provider:model ids and empty for the default", () => {
    expect(normalizeDesignModel(" Cerebras:Qwen-3.8-27b ")).toBe("cerebras:qwen-3.8-27b");
    expect(normalizeDesignModel("openrouter:x-ai/grok-4.1-fast")).toBe("openrouter:x-ai/grok-4.1-fast");
    expect(normalizeDesignModel("")).toBe("");
    expect(normalizeDesignModel(null)).toBe("");
  });

  it("rejects anything that is not provider:model", () => {
    expect(normalizeDesignModel("gpt-6")).toBeNull();
    expect(normalizeDesignModel("openai:")).toBeNull();
    expect(normalizeDesignModel("open ai:model")).toBeNull();
  });
});

describe("designModelConfig", () => {
  it("sends the chosen model per decision and nothing for the runtime default", () => {
    expect(designModelConfig("cerebras:qwen-3.8-27b")).toEqual({ config: { default_model: "cerebras:qwen-3.8-27b" } });
    expect(designModelConfig("")).toEqual({});
  });
});
