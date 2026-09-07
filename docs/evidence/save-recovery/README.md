# Actual save-recovery evidence

Baseline `e1bd77533decbb0a139c152cd5c0a8ae8d3eca81`; save fix `0da1b6a`.
The coding agent recorded its observation in commit `4c8bc79` before changing
save behavior. Instrumentation started in `95e77e2` and was refined using actual
MCP/browser observations through `3087f60`. No merge, push or PR publication.

- [Before: saved document](01-before-saved.png)
- [Before: failed save with no recovery](02-before-not-saved.png)
- [After: automatic retry and useful status](03-after-auto-retry.png)
- [After: exhausted retries and manual fallback](04-after-manual-fallback.png)
- [Successful MCP recovery](05-after-mcp-recovery.png)
- [Successful Retry save button](06-after-ui-recovery.png)
- [Persisted text after reload](07-after-reload.png)
- [Automatic recovery without a click](08-after-automatic-recovery.png)
- [Production with no inspection connection](09-production-no-inspection.png)
- [34-second actual browser recording](save-recovery.mp4)
- [Actual MCP excerpts and browser observations](transcript.jsonl)
- [Exact runtime and dependency versions](versions.json)

The recording concatenates two real Playwright screen-recording excerpts at
normal speed: baseline seconds 23–35, then after seconds 225–247. No synthetic
frames, simulated UI or model-generated video
are used. Full source recordings and raw transcripts remain locally under
`.tmp/save-recovery-baseline/` and `.tmp/save-recovery-after/`. Original clocks
are UTC in transcripts; file names identify the final screenshot of each state.

The transcript retains actual MCP structured results, omitting duplicate text
representations. Large definitions use explicitly marked excerpt paths. Browser
observations and persisted reads contain only synthetic fixture documents.
Some intermediate observations show setup mistakes or code-refresh effects;
the final screenshots and assertions correspond to the completed scenarios.

## Verified

The baseline had one aborted IndexedDB write, no additional attempt after 4.5
seconds, UI `not saved`, MCP `open.ready` with a save error, a false
`can_handle_event(user.retrySave)` result, a rejected retry command and the older
content still persisted. The observation drove the added retry states.

After the fix, three injected aborts produced exactly the initial write and two
retries, then a visible manual fallback. An invalid MCP edit was rejected; a
valid MCP retry succeeded and the exact draft was independently read from
IndexedDB. Clicking Retry save also recovered. The latest text survived reload,
and the refreshed hierarchy contained one root with all four domain actors.
A separate single-abort fixture recovered automatically with one retry.

Restarting the actual stdio MCP server replayed the same hierarchy and latest
document snapshot. Final native browser socket checks showed one OPEN socket
after StrictMode/refresh; a hot refresh closed the previous socket and opened one
replacement. Unmount left zero retained server actors. Earlier PLAYWRIGHT socket
event summaries include stale entries; the `actual` entries use native browser
`readyState`, and are the authoritative checks for the current document.

Production was built with `NEXT_PUBLIC_XSTATE_INSPECT=1` deliberately set.
Chrome observed zero inspection sockets and MCP listed zero actors. Unit coverage
also verifies offline event/byte limits, latest snapshot replay, redaction,
command validation, stale-write serialization and retry cancellation.

Final checks: 81 tests in 11 files, lint, TypeScript through Next build, and the
production build pass. The source server built successfully with its frozen
dependencies. It is an unmerged `xstate-mcp` development build pinned to
`16c7a0004dce3f676eab0b5606be1e3542c89449`; the package says 1.0.1 while its
stdio handshake says 1.0.0. This run used Node 26.8.1, not a claim about the
upstream supported runtime matrix. Upstream reliability/release integration
remains open.

All storage faults are fixtures calling actual IndexedDB `transaction.abort()`.
No paid/live in-app model session occurred; port 7100 traffic was blocked, so
the assistant history-load error shown in screenshots is expected. Coding agent:
Codex CLI, identified by the system as GPT-6; exact deployment identifier,
token usage and cost were unavailable.

Reproduce with [the setup and interactive brief](../../save-recovery-demo.md).
Export raw local runs with `node scripts/export-save-evidence.mjs`. Hot code
refresh deliberately remounts the development provider from persisted data;
it does not preserve an unsaved draft across a code update.
