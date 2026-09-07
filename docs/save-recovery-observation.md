# Observation before implementing recovery

Captured 2026-09-07, 18:55 UTC, through the interactive coding-agent MCP SDK
stdio session and isolated Chrome. Baseline document behavior is unchanged from
`e1bd775`; instrumentation commits are `95e77e2`, `63b6dd5`, `99513db`.

Actual evidence is in `.tmp/save-recovery-baseline/transcript.jsonl` and
`01-before-saved.png`, `02-before-not-saved.png` beside it. Setup attempts are
separately retained in `.tmp/save-recovery/` and are not successful baseline runs.

The real actor tree has one app root, four spawned domain actors and invoked
storage, renderer and socket actors. The document actor was
`4545459d-4da7-45a2-b64c-7d94dce268fa:x:3`.

1. Created a synthetic document and saved `Persisted baseline.` through the UI.
2. Enabled a fixture that calls `IDBTransaction.abort()` for the next document
   store `put`, then typed `Unsaved draft must survive retry.`.
3. Waited 4.5 seconds. UI remained `not saved`, with no retry button. Fixture
   counters: 3 writes total, 1 aborted, 2 committed, no further attempt.
4. Actual `get_actor_state` returned `value: {open: "ready"}`, 64 draft characters
   and the redacted `saveError: "Storage write failed"` summary.
5. `get_event_history` showed the saver error followed by renderer completion.
   `get_state_timeline` showed `dirty → saving → rendering → ready` on that error.
6. `can_handle_event(user.retrySave)` returned false. An actual `send_event`
   retry request returned `success: false`, application rejection.
7. An independent IndexedDB read still returned `Persisted baseline.`.

This evidence drives the change: a failed save needs its own bounded retry state
and a visible manual fallback. Render completion cannot imply persistence.
Keep the current draft and serialize saves so edits during an outstanding write
cannot create competing writes or let an older completion mark a newer draft saved.

The first real definition reads also exposed live StateNode targets omitted by
the policy serializer. `99513db` projects these as plain IDs; the dev server
must reload that adapter before final definition/reconnect verification. This is
instrumentation work, not evidence that save recovery already works.

No in-app model call was made. Runtime connections are blocked fixtures; the
assistant panel's visible history-load error is expected in this isolated run.
