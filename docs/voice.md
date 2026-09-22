# Live voice and the design controller

**Talk live** connects the studio to GPT-Live 1 through assistant-runtime.
The voice listens and speaks; it never edits. An independent *design
controller* reads the transcript and decides whether to make one document
edit or leave the document unchanged. It uses the same six host actions as
text chat while the voice conversation continues.

For installation, voice credentials and a first call, follow
[Talk through a design](../README.md#talk-through-a-design). This guide
explains the controls and the request flow for readers integrating the runtime.

## The split

| | Voice (GPT-Live) | Design controller | The app |
| --- | --- | --- | --- |
| Hears | the person, itself | the ordered transcript through the latest utterance, plus the document, selected block and render results sent as host context | transcript fragments, decisions, action results |
| Does | conversation only: no tools, no delegation | one silent decision per utterance: a host action, or `hold` (no edit) | performs the action, renders Mermaid, reports the result |
| Says | what it heard and thinks; mentions a change only after the app confirms it | nothing: tool calls only, receipts stay internal | a quiet fact to Live after every action |

The voice persona is [profiles/live-instructions.md](../profiles/live-instructions.md), sent as
`instructions` when the call is created, with the app's `profile`; a
prompt change takes effect on the next call.
The controller's instructions are [profiles/design-controller.md](../profiles/design-controller.md), sent
as the message of every decision.

## How a decision runs

1. The runtime's call event stream delivers transcript fragments. The
   voice machine merges the user's fragments into an utterance (fragments
   less than 1.5 s apart are one utterance, even when Live says "mm-hm"
   in between) and announces it to the app.
2. The design controller waits 0.9 s of quiet; more speech restarts the
   wait, grouping nearby transcript fragments into one decision. Speech that
   arrives while a decision is in flight is kept and decided on afterwards;
   it does not cancel the decision. This lets an edit finish even when the
   person speaks in short fragments.
3. The decision is `POST /api/chat` with `output_mode: "host_tools"` on a
   fresh session (`design-<uuid>`) with `profile: "design_studio"`, the
   conversation and the controller instructions as `content`, the host context
   (document, blocks, selection, render outcomes; no screenshot) and, when chosen,
   `config.default_model`. The runtime answers `hold` (no edit) or one
   `pending_tool_call`.
4. The action goes through the document machine exactly like a text-chat
   action, with the conversation's session (a document created by voice
   keeps the text chat). A Mermaid parse error is a successful action with
   `render: {ok: false}`; the next decision sees it in the host context and
   the controller repairs the block first.
5. The app sends the action result back to the decision session (`decision:
   "completed"`, no model call) and a bounded fact goes to Live over the
   data channel as `session.thinking.append` with `delegation_id: null`:
   the action, the block, applied or failed, and the render error if any.
   Live may then say "the queue is in now"; it never claims a change
   before that.

**Mute** turns off microphone transmission without ending the call.
**Stop** cancels the decision in flight (the runtime is asked to cancel
planning, the request is aborted) and drops queued speech. Voice continues,
and later speech can trigger a new decision. An edit already handed to the
document machine completes and its result is sent to the runtime. **End call**
mutes at once, asks the runtime to close, and reports an unconfirmed close
instead of assuming the provider finished. The microphone is enabled only
after the provider's `session.started` and never without the click.

Two machines own this: `voiceMachine` (the call: connect, active with
mute and facts, confirmed close) and `designControllerMachine` (listening,
the quiet period, deciding, executing, returning the result). `lib/voice-client.ts`
is the browser transport; `lib/design-runtime.ts` the decision transport.
The document machine refuses a second action while one is being
performed, since the text assistant and the controller can both call it.

## The design model

The **Design model** control in the header chooses the model for
decisions: built-in candidates and **Other…** for a `provider:model` identifier.
The runtime must have credentials and access for the selected provider/model.
The choice is a browser preference (`localStorage`,
`design-studio:design-model`) and travels with each decision as
`config.default_model`. With **Runtime default**, the app uses
`NEXT_PUBLIC_DESIGN_MODEL` if set, otherwise the shared request default
`NEXT_PUBLIC_ASSISTANT_MODEL` if set, otherwise the runtime's primary model.
Selecting a design model does not change text chat or the voice. A
model the runtime cannot route fails that one decision with the runtime's
error, shown as a toast and in the controller line; the call continues.

## One runtime, started by you

One assistant-runtime serves text, voice and design decisions, for this
app and any other app registered with it. Start it with
`assistant-runtime serve --port 7100` and this app's profile in
`ASSISTANT__PROFILES`; the studio never starts, replaces or stops it.
`make dev` here checks `GET /health` and
`GET /api/artifacts/profile?profile=design_studio` before starting the app.
It exits with an explanation if the runtime is
unreachable, rejects the request, is unhealthy, is not an
assistant-runtime, lacks the profile-registration contract, or does not have
`design_studio` registered. Text chat can start without voice enabled;
**Talk live** additionally requires conversation mode and per-call instructions
support, an OpenAI key and a browser on localhost or HTTPS.

Everything app-specific travels with requests: the top-level `profile`
on every chat message, steering message, continuation, decision and
receipt (`lib/profile.ts`), `?profile=` on artifact routes, `profile` and
`instructions` on voice creation. Text and decision requests also carry
`config` with the thinking budget, working memory off and model overrides.
Provider credentials,
`VOICE__ENABLED` and model-access restrictions remain runtime settings.
See `assistant-runtime docs configuration` and `assistant-runtime docs voice`.

## Measurements

### Decision latency, offline (September 16, 2026)

These historical samples measure the controller request for a four-turn
conversation ending in “put a queue between the API and the worker” on a
one-diagram document. They exclude voice transcription, the quiet period,
and applying/rendering the edit. Each returned action was acknowledged as
not executed. They illustrate model-dependent decision time, not an
end-to-end latency guarantee or a current model ranking.

| Model | Decision | Result |
| --- | --- | --- |
| Runtime default (`openai:gpt-5.6-sol`, Codex) | 6.0 s, 20.6 s, 4.5 s | `replace_block b1` with the queue, every time |
| `cerebras:qwen-3.8-27b` | 2.1 s, 2.1 s, 1.5 s | `replace_block b1` with the queue, every time |
| `cerebras:gpt-oss-120b` | 1.5 s, 1.4 s, 1.8 s | `replace_block b1` with the queue, every time |

### Measure a live edit

After an applied edit, the controller line shows “... after you spoke”.
This measures from receipt of the latest utterance fragment to the document
machine's action result. It includes the 0.9 s quiet period, any wait behind
an earlier decision, the model decision and the local edit/render. It excludes
the time between speaking and receiving that transcript fragment, so it is
not a measurement from the actual last audible word.

To compare models, repeat the same edit request three times on equivalent
documents for each model and record the displayed values. Measure “last
word to first visible change” separately from a recording if that is the
latency you need. No end-to-end live measurements are published here yet.
