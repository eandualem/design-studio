// Before the studio starts: is the assistant-runtime it talks to there, and
// does it know this app's profile? The runtime is started separately (its
// own `make dev`); the studio never starts, replaces or stops it. Exit 0
// when reachable, healthy and registered, 1 otherwise, with one line saying
// what to do.
const url = (process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://127.0.0.1:7100").replace(/\/$/, "");
const hint = "Start it first (make dev in the assistant-runtime checkout), then run make dev again.";
const PROFILE = "design_studio";
const profilePath = new URL("../profiles/design-studio.toml", import.meta.url).pathname;

let response;
try {
  response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
} catch (error) {
  const cause = error?.name === "TimeoutError" ? "timed out after 3 s" : (error?.cause?.code ?? error?.code ?? "connection failed");
  console.error(`assistant-runtime is not reachable at ${url} (${cause}). ${hint}`);
  process.exit(1);
}
if (response.status === 401 || response.status === 403) {
  console.error(`assistant-runtime at ${url} rejected the request (HTTP ${response.status}): check ACCESS__LOCAL_TOKEN.`);
  process.exit(1);
}
const health = await response.json().catch(() => null);
if (!response.ok || !health || health.healthy !== true) {
  const components = Object.entries(health?.components ?? {})
    .filter(([, c]) => c && c.healthy === false)
    .map(([name]) => name);
  console.error(
    `assistant-runtime at ${url} reports unhealthy${components.length ? `: ${components.join(", ")}` : ` (HTTP ${response.status})`}. ${hint}`,
  );
  process.exit(1);
}
const llm = health.components?.llm_service;
if (!llm) {
  console.error(`${url} answers /health but is not an assistant-runtime. ${hint}`);
  process.exit(1);
}
const voice = health.components?.voice_service ?? {};
let profiles;
try {
  const answer = await fetch(`${url}/api/artifacts/profile?profile=${PROFILE}`, { signal: AbortSignal.timeout(3000) });
  profiles = answer.ok ? (await answer.json())?.available_profiles : answer.status;
} catch {
  profiles = undefined;
}
if (!Array.isArray(profiles) || !profiles.includes(PROFILE)) {
  console.error(
    `assistant-runtime at ${url} does not have the ${PROFILE} profile registered${
      typeof profiles === "number" ? ` (HTTP ${profiles})` : Array.isArray(profiles) ? ` (has: ${profiles.join(", ") || "none"})` : ""
    }. Add ${profilePath} to ASSISTANT__PROFILES in the runtime's .env and restart it.`,
  );
  process.exit(1);
}
const voiceState = voice.enabled ? (voice.configured ? "voice enabled" : "voice enabled, no key") : "voice disabled";
console.log(`runtime ${url}: ${llm.primary_model ?? "model unknown"}, ${voiceState}`);
if (!voice.enabled)
  console.log("Talk live will be refused until assistant-runtime is started with voice enabled (VOICE__ENABLED).");
