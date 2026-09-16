/**
 * This app's registered assistant profile (`name` in profiles/design-studio.toml).
 * The runtime is started once for every app that connects to it, with each
 * profile registered in ASSISTANT__PROFILES; every request names its own, so
 * the prompt artifacts (persona, protocol, style guide, scratchpad) are this
 * app's regardless of what else the runtime serves.
 */
export const PROFILE = "design_studio";

/**
 * The per-request defaults that used to be startup settings: the thinking
 * budget and working memory off. The text model stays the runtime's primary
 * unless NEXT_PUBLIC_ASSISTANT_MODEL names one; design decisions choose
 * their own model (lib/design-model.ts).
 */
export const REQUEST_CONFIG: Readonly<Record<string, unknown>> = {
  thinking_budget: 4000,
  enable_working_memory: false,
  ...(process.env.NEXT_PUBLIC_ASSISTANT_MODEL ? { default_model: process.env.NEXT_PUBLIC_ASSISTANT_MODEL } : {}),
};

/** `?profile=` for artifact routes, which scope by the same name. */
export const PROFILE_QUERY = `?profile=${encodeURIComponent(PROFILE)}`;
