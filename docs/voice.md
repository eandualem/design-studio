# Live voice and the design controller

**Talk live** connects the studio to GPT-Live 1 through assistant-runtime.
The voice listens and speaks; it never edits. An independent *design
controller* hears the same conversation and turns each utterance into one
document edit through the same six host actions text chat uses, in parallel
with the voice. This is the pattern Avatar Studio uses for its body
(`docs/parallel-body-control.md` there); Design Studio adopts it so the two
apps are recognisably the same architecture with a different surface.

## The split

| | Voice (GPT-Live) | Design controller | The app |
| --- | --- | --- | --- |
| Hears | the person, itself | the ordered transcript through the latest utterance, plus the host context text chat sends | transcript fragments, decisions, action results |
| Does | conversation only: no tools, no delegation | one silent decision per utterance: a host action, or `hold` | performs the action, renders Mermaid, reports the result |
| Says | what it heard and thinks; mentions a change only after the app confirms it | nothing: tool calls only, receipts stay internal | a quiet fact to Live after every action |

The voice persona is `profiles/live-instructions.md`; the runtime reads it
at startup (`VOICE__CONVERSATION_INSTRUCTIONS_FILE`), so a prompt change
needs a runtime restart.
The controller's instructions are `profiles/design-controller.md`, sent
as the message of every decision.

## How a decision runs

1. The runtime's call event stream delivers transcript fragments. The
   voice machine merges the user's fragments into an utterance (fragments
   less than 1.5 s apart are one utterance, even when Live says "mm-hm"
   in between) and announces it to the app.
2. The design controller waits 0.9 s of quiet; more speech restarts the
   wait, so a sentence spoken with pauses is one decision. Speech that
   arrives while a decision is in flight is kept and decided on afterwards;
   it does not cancel the decision (Avatar's issue #48 showed that
   cancelling starves the controller on a halting sentence).
3. The decision is `POST /api/chat` with `output_mode: "host_tools"` on a
   fresh session (`design-<uuid>`), the conversation and the controller
   instructions as `content`, the host context (document, blocks,
   selection, render outcomes; no screenshot) and, when chosen,
   `config.default_model`. The runtime answers `hold` or one
   `pending_tool_call`.
4. The action goes through the document machine exactly like a text-chat
   action, with the conversation's session (a document created by voice
   keeps the text chat). A Mermaid parse error is a successful action with
   `render: {ok: false}`; the next decision sees it in the host context and
   the controller repairs the block first.
5. The result is receipted on the decision session (`decision:
   "completed"`, no model call) and a bounded fact goes to Live over the
   data channel as `session.thinking.append` with `delegation_id: null`:
   the action, the block, applied or failed, and the render error if any.
   Live may then say "the queue is in now"; it never claims a change
   before that.

**Stop** cancels the decision in flight (the runtime is asked to cancel
planning, the request is aborted) and drops queued speech; an edit already
handed to the document machine completes and is receipted. **End call**
mutes at once, asks the runtime to close, and reports an unconfirmed close
instead of assuming the provider finished. The microphone is enabled only
after the provider's `session.started` and never without the click.

Two machines own this: `voiceMachine` (the call: connect, active with
mute and facts, confirmed close) and `designControllerMachine` (listening,
the quiet period, deciding, executing, receipting). `lib/voice-client.ts`
is the browser transport; `lib/design-runtime.ts` the decision transport.
The document machine now refuses a second action while one is being
performed, since the text assistant and the controller can both call it.

## The design model

The **Design model** control in the header chooses the model for
decisions: curated candidates (Avatar's table as the starting point, in
order of expected speed) and **Other…** for any `provider:model`. The
choice is a browser preference (`localStorage`,
`design-studio:design-model`) and travels with each decision as
`config.default_model`; **Runtime default** sends none, so the runtime's
primary model decides, unless the deployment sets
`NEXT_PUBLIC_DESIGN_MODEL`. Text chat and the voice are unaffected. A
model the runtime cannot route fails that one decision with the runtime's
error, shown as a toast and in the controller line; the call continues.

## One runtime, started by you

One assistant-runtime on 7100 serves text, voice and design decisions.
You start it; the studio never starts, replaces or stops it (`make dev`
only preflights `GET /health` and exits with one line if the runtime is
unreachable, rejects the request, is unhealthy, or is not an
assistant-runtime). `runtime/design-runtime.env` holds the settings it
needs, with the launch command in its header: Codex-only `openai:`
models with Sol as the primary, GPT-Live in conversation-only mode with
the Live prompt, per-request design models. Keys stay in the runtime's
own `.env`: `OPENAI_API_KEY` funds Live audio, `CEREBRAS_API_KEY` the
fast candidates. Without a Codex login, drop the two Codex lines and name
your provider's model. The README's two-terminal recipe is still the
simple, text-only path.

The profile and the Live prompt are startup settings of the runtime, so a
runtime started for Design Studio carries Design Studio's persona; a
runtime shared with Avatar Studio carries whichever it was started with.
Per-request profile selection and per-call Live instructions are landing
in the runtime (`ASSISTANT__PROFILES`, a top-level `profile` on every
request, `profile` + `instructions` on call creation); the app adopts them
in # rather than writing global artifacts or settings to
work around it.

GPT-Live bills connected time, silence included ($0.05 per minute on
September 13, 2026); decisions are billed by their model. End the call
when finished.

## Measurements

### Decision latency, offline (September 16, 2026)

The controller's request as the app sends it, against the runtime on
7100 (`8019c99`+, started from `runtime/design-runtime.env`), for a four-turn
conversation ending in "put a queue between the API and the worker" on a
one-diagram document. The action was not executed; each pending decision
got a failed receipt. Script and raw rows: `.tmp/benchmark-design-models.ts`,
`.tmp/design-model-benchmark-2026-09-16.json` (untracked).

| Model | Decision | Result |
| --- | --- | --- |
| Runtime default (`openai:gpt-5.6-sol`, Codex) | 6.0 s, 20.6 s, 4.5 s | `replace_block b1` with the queue, every time |
| `cerebras:qwen-3.8-27b` | 2.1 s, 2.1 s, 1.5 s | `replace_block b1` with the queue, every time |
| `cerebras:gpt-oss-120b` | 1.5 s, 1.4 s, 1.8 s | `replace_block b1` with the queue, every time |
| `google:gemini-3.8-flash` (no key) | — | fails at once with the runtime's setup error; the call would continue |

Last word to first document change adds the 0.9 s quiet period, the
runtime's transcript delivery and the local edit and render (tens of
milliseconds) to the decision time.

### Last word to first document change, live

To be measured in a real call: three samples each for the runtime default
and one fast candidate. The controller line in the panel shows this
figure for the last decision ("… after you spoke"), from the moment the
utterance's last fragment arrived to the moment the document machine
reported the edit.
