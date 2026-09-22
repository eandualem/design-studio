# Design Studio

Design Studio is a small web application for writing software design
documents: Markdown with [Mermaid](https://mermaid.js.org) diagrams,
rendered live, and an assistant sitting beside them. You describe a
system, the assistant draws the diagram, you ask for changes and it edits
the document in place. When Mermaid rejects a diagram it wrote, it reads
the parse error and fixes it.

It exists to demonstrate
[assistant-runtime](https://pypi.org/project/assistant-runtime/), an
assistant backend that an application puts behind its own interface. The
runtime owns the conversation, calls the model and streams the result.
The application describes what is on screen and performs the actions the
model asks for. Design Studio is a complete, deliberately small example
of the application half of that arrangement: one screen, no accounts, and
documents stored in your browser. The Next.js app and the runtime run as
separate local processes.

![The studio: the document list, the Markdown and Mermaid preview, and the assistant panel](public/screenshot.png)

## Run locally

You need Git, [Bun](https://bun.sh), [uv](https://docs.astral.sh/uv/)
for installing the Python runtime (Python 3.12 or newer), and `make`.
The example below uses an Anthropic API key with credit for text chat.
Other providers are supported; see `assistant-runtime docs configuration` after installation.

### 1. Get the app

```bash
git clone https://github.com/eandualem/design-studio
cd design-studio
bun install
```

### 2. Start the runtime

In that same terminal, from the `design-studio` directory:

```bash
uv tool install 'assistant-runtime[voice]==0.2.0'
export ANTHROPIC_API_KEY='replace-with-your-key'
export ASSISTANT__PROFILES="[\"$PWD/profiles/design-studio.toml\"]"
assistant-runtime serve --port 7100
```

The profile registers this app's assistant instructions and diagram style
guide under the name `design_studio`. Its path must be absolute; the command
above expands it from the checkout. Keep this terminal running. The runtime
also reads a `.env` file in the directory from which it starts.

This recipe pins assistant-runtime 0.2.0, the minimum version for the
profile registration and per-call voice instructions used here. The runtime's
own setup and configuration references ship with the package:

```bash
assistant-runtime docs
assistant-runtime docs configuration
assistant-runtime docs host-contract
```

### 3. Start the studio and create a document

Open a second terminal in the same `design-studio` checkout and run:

```bash
make dev
```

`make dev` checks that the runtime is reachable, healthy and has the
`design_studio` profile registered, then starts the app on port 7130.
`bun run dev` starts the app directly and skips those checks. Neither command
starts or stops the runtime. Voice can be disabled while text chat works.

Open <http://localhost:7130> and send:

> Design a payment service with an API, a worker, Postgres and a queue.

The assistant should create a document in the sidebar and render a diagram
in **Preview**. Then ask: *“Make the diagram left to right and add a
dead-letter queue.”* The existing document should update. Use **Source**
to inspect or edit its Markdown.

### Connection and saved data

The studio connects to `http://127.0.0.1:7100`. To use another runtime,
set `NEXT_PUBLIC_RUNTIME_URL` in the app terminal before starting it:

```bash
NEXT_PUBLIC_RUNTIME_URL=http://127.0.0.1:7102 make dev
```

Documents are stored in IndexedDB, the browser's local database. They survive
page reloads and runtime restarts, but are specific to that browser and site
address; clearing site data removes them. Conversations are stored separately
by the runtime. Without its optional Postgres configuration, they are lost on
runtime restart even though the documents remain. For durable conversations,
follow `assistant-runtime docs persistence`, configure the database and run
`assistant-runtime migrate` before starting the runtime. Runtime session
retention still applies; Postgres is not an indefinite conversation archive.

### Talk through a design

For voice, add these variables in the runtime terminal before starting
`assistant-runtime serve` (restart it if already running):

```bash
export VOICE__ENABLED=true
export OPENAI_API_KEY='replace-with-your-openai-key'
```

Keep the text/design provider key and profile registration from the setup
above. Voice uses OpenAI independently of the model that edits the document.
Use a browser with microphone access and WebRTC (browser audio streaming)
support on localhost or HTTPS. The OpenAI key needs access to GPT-Live.
Live calls incur provider charges; use **End the call** when finished.

Press **Talk live**, allow microphone access, and describe a system. The
**Design model** control in the header selects the model for document edits;
its provider must be available in the runtime. **Mute** silences your microphone;
**Stop** stops the controller's current decision; **End the call** closes voice.
See [the voice guide](docs/voice.md) for the control behavior and architecture.

## Using it

The centre pane has a **Source** tab you can type in and a **Preview** tab
that renders it. A document is split into blocks, headings and paragraphs
as text and fenced `mermaid` code blocks as diagrams; the assistant edits
one block at a time. Click a block in the preview to select it, and the
assistant is told what you selected.

The right pane is the assistant. Each document carries its own
conversation, so switching documents switches the chat. The book icon in
its header opens the assistant's artifacts, where a proposed style-guide
change waits for approval.

## What it demonstrates

- **Host context.** The app tells the model what is on screen: the open
  document, its blocks with a one-line summary each, which block is
  selected, and whether every diagram rendered.
- **Host actions.** The model requests edits for the app to perform. It calls
  six actions the app declares (`create_document`, `open_document`,
  `replace_block`, `insert_block`, `delete_block`, `rename_document`); the
  app performs them and hands back the result, including the Mermaid
  render outcome. A parse error is a successful action with a failed
  render, which is what lets the assistant repair its own diagram.
- **Streaming, steering and cancellation.** Thinking, text and tool calls
  arrive as they happen. A message sent while the assistant is working
  becomes a mid-turn nudge; stopping a turn keeps the partial answer.
- **Branching.** "Try a variant" sends a different message from an earlier
  point in the conversation; a switcher moves between the branches, which
  the runtime keeps as a tree.
- **Attachments.** Drop an image into the chat and the assistant sees it.
  When a preview screenshot is available, it travels with the message, and
  the assistant looks at it only when it decides to.
- **Prompt artifacts.** These are the assistant's instructions, visible in
  the panel. One of them, the diagram style guide, is one the assistant
  may propose changes to: say "always put a legend in architecture
  diagrams" and it proposes a new version, which waits for your approval.
- **Cost.** Tokens and cost per message, and a running total for the
  session.
- **Recovery.** Reload the page while the assistant is waiting for the app
  to perform an action and the reloaded page performs it and continues.
- **Two model roles in parallel.** *Talk live* puts GPT-Live on the
  conversation while a separate design controller turns what you say into
  document edits through the same six actions, each decision on the model
  you pick in the header. See [docs/voice.md](docs/voice.md).

## The demo

With both processes running and Google Chrome installed, `bun run demo`
drives the text-chat workflow through the real app and writes screenshots
and a table of timings and costs to `.tmp/demo/`:

1. Ask for a payment service. The assistant creates the document and draws
   the first diagram.
2. Ask for it left to right with a dead-letter queue. It edits the blocks.
3. Ask for something that makes Mermaid fail. It reads the parse error and
   repairs the diagram.
4. Try a variant of step 2 as a sequence diagram, then switch between the
   two branches.
5. Nudge the assistant mid-answer, then cancel it; the partial answer
   stays.
6. Drop a whiteboard photo and ask for it as a diagram.
7. Ask whether the queue is readable; the assistant looks at the preview.
8. Reload the page while an edit is pending; the reloaded page finishes it.
9. State a lasting preference; approve the style-guide change it proposes.
10. Read the cost per message and for the session.

The demo makes real model calls; duration and cost depend on the configured
model. `DEMO_STEPS=1,2 bun run demo` runs a subset. Supply an image with
`DEMO_PHOTO=/path/to/sketch.png bun run demo`; step 6 is skipped if no image
is available (the default path is `.tmp/demo/whiteboard.png`).

## How it is built

Next.js and XState, in four layers that do not reach past each other:
components render props, hooks expose `{ state, data, actions }`, machines
hold every transition and side effect, and `lib/` contains pure helpers
and runtime clients.

| Directory | What lives there |
|---|---|
| `machines/` | `appMachine` (root), `filesMachine`, `documentMachine`, `assistantMachine`, `artifactsMachine`; `voiceMachine` and `designControllerMachine` for live calls |
| `hooks/` | the bridge between machines and components |
| `components/` | `assistant/`, `document/`, `layout/`, `ui/` |
| `lib/` | block parsing and edits, host actions, stream folding, host context, the runtime client, IndexedDB, Mermaid, the voice and decision transports |
| `types/` | Zod schemas for every wire shape |
| `profiles/` | the assistant profile and its artifact texts |

The interesting file is `machines/assistantMachine.ts`: the socket, the
stream folded into messages, and the pause on a pending host action that
the app answers with a continuation.

```bash
make check  # tests, typecheck, lint and production build
```

Contributor notes are in [AGENTS.md](AGENTS.md).

## License

MIT, see [LICENSE](LICENSE). The bundled Inter and JetBrains Mono fonts
are under the SIL Open Font License; see
[public/fonts/OFL.txt](public/fonts/OFL.txt).
