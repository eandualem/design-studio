# Save recovery through actual MCP observations

Issue: https://github.com/eandualem/design-studio/issues/1. Baseline:
`e1bd77533decbb0a139c152cd5c0a8ae8d3eca81`.

This local development scenario uses synthetic documents and injected IndexedDB
transaction aborts. It makes no paid or live in-app model call. Browser runtime
connections to port 7100 are blocked by the evidence harness.

## Pinned development integration

`xstate-mcp` is an **unmerged source build**, pinned to
`16c7a0004dce3f676eab0b5606be1e3542c89449` (PR #32). Its package advertises
1.0.1; that does not mean these changes are published. Reliability, lifecycle,
multi-client and release integration remain upstream work. Only the
`xstate-mcp/inspection-policy` browser-safe subpath is imported by the app.

```sh
bun install --frozen-lockfile
bun run inspector:prepare
NEXT_PUBLIC_XSTATE_INSPECT=1 bunx next dev --port 7131
```

In a separate terminal, `node scripts/inspect-save-recovery.mjs` opens a persistent
MCP SDK stdio session on request. It accepts one JSON command per line:

```json
{"op":"connect"}
{"op":"tools"}
{"op":"browser"}
{"op":"tool","name":"list_actors"}
{"op":"tool","name":"get_actor_tree"}
{"op":"click","name":"New document"}
{"op":"click","role":"tab","name":"Source"}
{"op":"fault","count":1}
{"op":"edit","content":"# Synthetic save recovery\n"}
{"op":"view"}
```

Use the discovered session IDs with `get_machine_definition`, `get_actor_state`,
`get_event_history`, `get_state_timeline`, `can_handle_event` and `send_event`.
Each actual request/result is appended to `.tmp/save-recovery/transcript.jsonl`.
`screenshot` takes a `name`; `closeBrowser` finalizes the real browser recording.
`disconnect` followed by `connect` tests reconnection and latest snapshot replay.
The harness is interactive: inspect the actual results before choosing the next
request or making a code change. It is not a pre-scripted repair demonstration.

Chrome and Playwright's recording helper must be installed. The profile lives
under the evidence directory; it never uses the normal browser's documents.
Install the helper with `bunx playwright-core install ffmpeg`. When the page has
two New document buttons, use `{"op":"click","name":"New document","index":1}`.
Wait for navigation to `/d/<id>` before selecting Source; routing remounts that
page's view state. Run the Next development server with filesystem watcher access;
macOS sandbox-denied watchers appeared as EMFILE errors and missing routes here.
Do not run a production build against the same `.next` directory while dev runs.

## Inspection boundary

Root-provider inspection captures spawned and invoked actors, their real machine
definitions, parent links, events and snapshots. Promise/callback actors have no
invented machine definition. XState's `_parent` metadata is used only by this
development adapter; the actual installed XState version is recorded with evidence.
Wire IDs include a unique producer prefix, and commands resolve back to actual
local actor session IDs before the application guard dispatches.

Snapshots expose only state/status and a small document summary: document ID,
character/block counts, a generic storage error and retry count when available.
Event payloads expose only event type. The pinned policy additionally redacts
content, input, output, errors, screenshot/render fields and default secret keys
before transfer. No live actor objects are serialized.

Both server and app explicitly permit only `user.edit` and `user.retrySave`.
The server actor wildcard accommodates generated IDs; the app further restricts
dispatch to the actual document actor, validates exact payload shapes and length,
and checks the event is enabled in its current snapshot. All other writes fail.
The server binds to loopback port 7358 and requires the exact app origin.

The adapter retains at most 128 actor references, 100 offline events, 64 KiB per
frame and 2 MiB total serialized data; it also caps socket buffered bytes. It
replays definitions, recent events and finally latest snapshots on reconnect.
StrictMode setup/cleanup closes the old socket; unmount clears data after the
synchronous development remount window. Connection creation waits until that
window settles, avoiding a socket handshake for an abandoned effect. HMR creates
a new inspector/provider generation and cleans up the old one; it reloads the
persisted document, so this development reset does not preserve unsaved drafts.
Production and development without `NEXT_PUBLIC_XSTATE_INSPECT=1` create no
inspection adapter or connection. No shared MCP configuration changes are needed.

## Result

The baseline evidence was committed in `4c8bc79` before recovery implementation.
The fix is `0da1b6a`: two automatic retries, 1.5 seconds apart, followed by a
visible Retry save button. New edits reset the retry budget. An outstanding save
finishes before the latest edited draft is written; manual retries are accepted
only at the fallback. Storage success clears the error and acknowledges saved.
Exhausted host saves reply failed once; Mermaid render failures retain their
successful-action/failed-render contract.

See [evidence and exact versions](evidence/save-recovery/README.md) and the
[review PR description](save-recovery-pr.md). Branch publication is authorized;
merging, deployment and package releases remain for maintainer review. The
original checkout and its untracked `.agents/` are untouched.
