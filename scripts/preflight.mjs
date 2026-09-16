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
let profileAnswer;
try {
  profileAnswer = await fetch(`${url}/api/artifacts/profile?profile=${PROFILE}`, { signal: AbortSignal.timeout(3000) });
} catch (error) {
  console.error(`assistant-runtime at ${url} answered /health but not /api/artifacts/profile (${error?.name ?? "request failed"}). ${hint}`);
  process.exit(1);
}
if (profileAnswer.status === 401 || profileAnswer.status === 403) {
  console.error(`assistant-runtime at ${url} rejected the profile request (HTTP ${profileAnswer.status}): check ACCESS__LOCAL_TOKEN.`);
  process.exit(1);
}
const registration = `Add ${profilePath} to ASSISTANT__PROFILES in the runtime's .env and restart it.`;
if (profileAnswer.status === 404) {
  console.error(`assistant-runtime at ${url} does not have the ${PROFILE} profile registered. ${registration}`);
  process.exit(1);
}
const profile = profileAnswer.ok ? await profileAnswer.json().catch(() => null) : null;
if (!profile) {
  console.error(`assistant-runtime at ${url} answered /api/artifacts/profile with HTTP ${profileAnswer.status}. ${hint}`);
  process.exit(1);
}
const profiles = Array.isArray(profile.available_profiles) ? profile.available_profiles : null;
if (!profiles) {
  console.error(`assistant-runtime at ${url} predates profile registration (no available_profiles); update it. ${registration}`);
  process.exit(1);
}
if (!profiles.includes(PROFILE)) {
  console.error(`assistant-runtime at ${url} does not have the ${PROFILE} profile registered (has: ${profiles.join(", ") || "none"}). ${registration}`);
  process.exit(1);
}
const voiceState = voice.enabled ? (voice.configured ? "voice enabled" : "voice enabled, no key") : "voice disabled";
console.log(`runtime ${url}: ${llm.primary_model ?? "model unknown"}, ${voiceState}`);
if (!voice.enabled)
  console.log("Talk live will be refused until assistant-runtime is started with voice enabled (VOICE__ENABLED).");
