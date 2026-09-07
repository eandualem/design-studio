# Design Studio — contributor notes

Design Studio is a demonstration application for
[assistant-runtime](https://pypi.org/project/assistant-runtime/): a
Markdown and Mermaid design-document editor with an assistant panel. The
README explains what it does and how to run it; this file is about
working on the code.

It is deliberately small, and staying small is a feature. Before adding
something, check it earns its place in a demonstration of the runtime.

## Architecture

Four layers, and nothing reaches past its neighbour:

```
components/   render props, no business logic, never import a machine
hooks/        the bridge: each returns { state, data, actions }
machines/     XState v5: every transition, every side effect
lib/          pure functions and clients, no React, no machine awareness
```

Machines are `appMachine` (root, spawns the rest), `filesMachine`,
`documentMachine`, `assistantMachine`, plus `artifactsMachine`.

Conventions worth knowing before you edit:

- Events are namespaced by source: `user.*`, `app.*`, `stream.*`,
  `host.*`, `sys.*`, `files.*`, `document.*`, `assistant.*`.
- Machines document themselves through XState `description` fields on the
  machine, states and transitions, not code comments.
- Guards are named in `setup({ guards })`; no inline anonymous guards.
- Every wire shape has a Zod schema in `types/`; nothing from the network
  is trusted into the app untyped.
- Components hold only view state (`useState` for a tab or a draft);
  anything that drives behaviour lives in a machine.

The full conventions are in `.claude/skills/xstate-architecture/SKILL.md`.

## The runtime boundary

This repository never modifies the runtime. It consumes four public
contracts: the Socket.IO namespace `/assistant`, the HTTP routes under
`/api`, version 1 of `host_context`, and the profile TOML in `profiles/`.
The runtime documents all four; `assistant-runtime docs` lists its pages
and `assistant-runtime docs host-contract` prints one. Its source is at
<https://github.com/eandualem/assistant-runtime>.

If the runtime behaves differently from its documentation, do not paper
over it in the app. Write down exactly what was sent and what came back
and report it to the runtime; a silent workaround here hides a bug that
every other host would hit too.

Host actions are declared in `lib/host-context.ts` and executed by
`documentMachine`. The result shapes matter: a Mermaid parse error is a
*successful* action carrying `render: {ok: false, error}`, because the
assistant is expected to read it and repair the block. `tool_outcome:
"failed"` is only for actions the app genuinely could not perform.

## Working on it

```bash
bun install
bun run dev      # http://localhost:7130, needs the runtime on 7100
bun run lint
bun run test     # Vitest: machines and lib
bun run build
bun run demo     # end-to-end in Chrome, needs both processes and a key
```

bun is the package manager and script runner; there is no npm lockfile.

Tests cover the machines and the pure helpers, with fake sockets, fake
storage and a fake renderer, so the whole conversation flow is testable
without a model. UI is verified by running the app, not by snapshots.

Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`), with a
body saying why. Keep every commit building.

## Scope

In scope: the document editor, the Mermaid preview, the assistant panel,
and the runtime features they exercise.

Out of scope: authentication, multi-user, server-side or cloud storage,
collaborative editing, renderers other than Mermaid, and a redesign of the
theme. Simplicity is a requirement here, not a preference.
