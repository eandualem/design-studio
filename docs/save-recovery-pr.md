# fix: recover failed document saves with bounded retries

For https://github.com/eandualem/design-studio/issues/1.
Local PR draft; do not publish or merge without further authorization.

An aborted IndexedDB save left the UI at `not saved` while the document machine
returned to `open.ready`, with no retry transition and older text still stored.
Actual MCP state/history reads and browser evidence reproduced this before the
recovery implementation (`4c8bc79`).

The document machine now retries twice at 1.5-second intervals and then exposes
Retry save. It retains the draft, serializes new edits behind an outstanding
write, ignores duplicate retry requests and only acknowledges saved after
storage succeeds. Host saves report failure once on exhaustion; Mermaid parse
failures preserve the existing successful-action render-error contract.

Opt-in development instrumentation captures the actual root/spawned/invoked
hierarchy with projected definitions, bounded redacted replay, validated narrow
commands and StrictMode/HMR cleanup. Production opens no inspection connection.
This uses an unmerged pinned `xstate-mcp` source build and a local SDK stdio
session, with synthetic browser documents and real transaction-abort fixtures.

Baseline: `e1bd775`. Initial instrumentation: `95e77e2`; observation-driven
instrumentation corrections: `63b6dd5`, `99513db`, `c260881`, `3087f60`.
Recorded pre-fix observation: `4c8bc79`. Recovery: `0da1b6a`.

Validation: 81 tests pass, lint passes, production build/typecheck passes. Real
browser/MCP runs cover command rejection, automatic/manual recovery, persisted
reload, hierarchy replay, native socket cleanup and zero production inspection
connections. [Screenshots, transcript, versions and recording](evidence/save-recovery/README.md).

No in-app model call, runtime changes or shared MCP configuration changes.
Coding-agent model identity is GPT-6 as reported by the system; exact deployment
ID, usage and cost are unavailable. HMR remounts from persisted data, so unsaved
draft preservation applies to save retries, not development code reloads.
