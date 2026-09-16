import type { DesignModelOption } from "@/types";

/**
 * The design model: which model makes the controller's decisions. The choice
 * lives in this browser only (a preference, see prefs.ts) and travels with
 * each decision as `config.default_model`; empty means the runtime's primary
 * model, or NEXT_PUBLIC_DESIGN_MODEL when the deployment sets one. Text chat
 * and the voice are unaffected. Candidates start from Avatar Studio's table, ordered
 * by expected decision speed; availability depends on the runtime's keys.
 */
export const DESIGN_MODEL_DEFAULT = "";
export const DESIGN_MODEL_ENV_DEFAULT = process.env.NEXT_PUBLIC_DESIGN_MODEL ?? "";

export const DESIGN_MODEL_OPTIONS: readonly DesignModelOption[] = [
  { id: DESIGN_MODEL_DEFAULT, label: "Runtime default", note: "the runtime's primary model" },
  { id: "cerebras:qwen-3.8-27b", label: "Qwen 3.8 27B · Cerebras", note: "~1,850 t/s, needs a Cerebras key" },
  { id: "cerebras:gpt-oss-120b", label: "GPT-OSS 120B · Cerebras", note: "~1,700 t/s, needs a Cerebras key" },
  { id: "openai:gpt-5.6-luna", label: "GPT-5.6 Luna", note: "Codex subscription" },
  { id: "openai:gpt-6-astra", label: "GPT-6 Astra", note: "~50 t/s, Codex subscription" },
  { id: "anthropic:claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", note: "needs an Anthropic key with credit" },
];

const MODEL_ID = /^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9._/:-]*$/;

/** A valid `provider:model` id, empty for the default, or null when malformed. */
export function normalizeDesignModel(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim().toLowerCase();
  if (!trimmed) return DESIGN_MODEL_DEFAULT;
  return MODEL_ID.test(trimmed) ? trimmed : null;
}

/** The `config` of a decision request: empty when the runtime default applies. */
export function designModelConfig(model: string): { config?: { default_model: string } } {
  const chosen = model || DESIGN_MODEL_ENV_DEFAULT;
  return chosen ? { config: { default_model: chosen } } : {};
}

/** The label the header shows for a choice, curated or typed. */
export function designModelLabel(model: string): string {
  return DESIGN_MODEL_OPTIONS.find((o) => o.id === model)?.label ?? model;
}
