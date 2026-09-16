// Before the studio starts: is the assistant-runtime it talks to there?
// The runtime is started separately (see runtime/design-runtime.env); the
// studio never starts, replaces or stops it. Exit 0 when reachable and
// healthy, 1 otherwise, with one line saying what to do.
const url = (process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://127.0.0.1:7100").replace(/\/$/, "");
const hint = "Start it first (see runtime/design-runtime.env), then run make dev again.";

let response;
try {
  response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
} catch {
  console.error(`assistant-runtime is not reachable at ${url}. ${hint}`);
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
const voiceState = voice.enabled ? (voice.configured ? "voice enabled" : "voice enabled, no key") : "voice disabled";
console.log(`runtime ${url}: ${llm.primary_model ?? "model unknown"}, ${voiceState}`);
