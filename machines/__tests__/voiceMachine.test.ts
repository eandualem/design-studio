import { describe, expect, it } from "vitest";
import { createActor, fromObservable, fromPromise, setup } from "xstate";
import { voiceMachine, type VoiceParentEvents } from "@/machines/voiceMachine";
import { initialVoiceView, type VoiceFragment, type VoiceView } from "@/types";
import type { VoiceClient } from "@/lib/voice-client";

const tick = () => new Promise((r) => setTimeout(r, 0));

function harness(options: { connectFails?: string; closeFails?: string } = {}) {
  let push: ((view: VoiceView) => void) | null = null;
  let view = initialVoiceView();
  const observe = fromObservable<VoiceView, VoiceClient>(() => ({
    subscribe: (observer) => {
      push = typeof observer === "function" ? observer : (value: VoiceView) => observer.next?.(value);
      push(view);
      return { unsubscribe: () => undefined };
    },
  }));
  const connects: number[] = [];
  const closes: number[] = [];
  const connect = fromPromise<void, VoiceClient>(async () => {
    connects.push(Date.now());
    if (options.connectFails) throw new Error(options.connectFails);
  });
  const close = fromPromise<void, VoiceClient>(async () => {
    closes.push(Date.now());
    if (options.closeFails) throw new Error(options.closeFails);
  });
  const toParent: VoiceParentEvents[] = [];
  const parent = createActor(
    setup({ actors: { voice: voiceMachine.provide({ actors: { observe, connect, close } }) } }).createMachine({
      invoke: { id: "voice", src: "voice" },
      on: {
        "voice.started": { actions: ({ event }) => toParent.push(event as VoiceParentEvents) },
        "voice.utterance": { actions: ({ event }) => toParent.push(event as VoiceParentEvents) },
        "voice.ended": { actions: ({ event }) => toParent.push(event as VoiceParentEvents) },
      },
    }),
  );
  parent.start();
  const actor = parent.getSnapshot().children.voice as ReturnType<typeof createActor<typeof voiceMachine>>;
  const report = (values: Partial<VoiceView>) => {
    view = { ...view, ...values };
    push?.(view);
  };
  const say = (fragment: VoiceFragment) => {
    const fragments = [...view.fragments, fragment];
    report({
      fragments,
      lastUserFragment: fragment.role === "user" ? fragments.length - 1 : view.lastUserFragment,
    });
  };
  return {
    actor,
    parent,
    toParent,
    connects,
    closes,
    report,
    say,
    state: () => actor.getSnapshot().value,
    ctx: () => actor.getSnapshot().context,
  };
}

describe("voiceMachine", () => {
  it("connects on Talk live, announces the start, and ends cleanly", async () => {
    const h = harness();
    expect(h.state()).toBe("idle");
    h.actor.send({ type: "user.start", history: [{ role: "user", content: "earlier" }] });
    expect(h.state()).toEqual({ call: "connecting" });
    await tick();
    expect(h.state()).toEqual({ call: "active" });
    expect(h.toParent).toEqual([{ type: "voice.started" }]);
    h.actor.send({ type: "user.end" });
    expect(h.state()).toEqual({ call: "closing" });
    await tick();
    expect(h.state()).toBe("idle");
    expect(h.closes).toHaveLength(1);
    expect(h.ctx().client).toBeNull();
    expect(h.ctx().error).toBeNull();
    expect(h.toParent.at(-1)).toEqual({ type: "voice.ended" });
    h.parent.stop();
  });

  it("announces each user utterance once, with the conversation through it", async () => {
    const h = harness();
    h.actor.send({ type: "user.start", history: [] });
    await tick();
    h.report({ callId: "c1" });
    h.say({ role: "assistant", delta: "Hi, what are we designing?", start_ms: 0, end_ms: 900 });
    expect(h.toParent.filter((e) => e.type === "voice.utterance")).toHaveLength(0);
    h.say({ role: "user", delta: "A payment ", start_ms: 1000, end_ms: 1500 });
    h.say({ role: "user", delta: "service", start_ms: 1600, end_ms: 2000 });
    const utterances = h.toParent.filter((e) => e.type === "voice.utterance");
    expect(utterances).toHaveLength(2);
    expect(utterances[1]).toMatchObject({
      utterance: {
        utterance: "A payment service",
        conversation: [
          { role: "assistant", content: "Hi, what are we designing?" },
          { role: "user", content: "A payment service" },
        ],
      },
    });
    h.report({ micMuted: true });
    expect(h.toParent.filter((e) => e.type === "voice.utterance")).toHaveLength(2);
    expect(h.ctx().view.micMuted).toBe(true);
    h.parent.stop();
  });

  it("closes the call and keeps the reason when setup fails", async () => {
    const h = harness({ connectFails: "Microphone access was denied." });
    h.actor.send({ type: "user.start", history: [] });
    await tick();
    await tick();
    expect(h.state()).toBe("idle");
    expect(h.closes).toHaveLength(1);
    expect(h.ctx().error).toBe("Could not start the live call: Microphone access was denied.");
    expect(h.toParent).toEqual([{ type: "voice.ended" }]);
    h.parent.stop();
  });

  it("closes when the provider ends the call and surfaces an unconfirmed close", async () => {
    const h = harness({ closeFails: "The provider did not confirm the call ended." });
    h.actor.send({ type: "user.start", history: [] });
    await tick();
    h.report({ remoteClosed: true });
    expect(h.state()).toEqual({ call: "closing" });
    await tick();
    expect(h.state()).toBe("idle");
    expect(h.ctx().error).toBe("The provider did not confirm the call ended.");
    h.parent.stop();
  });

  it("does not announce speech after the remote side closed", async () => {
    const h = harness();
    h.actor.send({ type: "user.start", history: [] });
    await tick();
    h.report({ remoteClosed: true, fragments: [{ role: "user", delta: "late words" }], lastUserFragment: 0 });
    expect(h.toParent.filter((e) => e.type === "voice.utterance")).toHaveLength(0);
    h.parent.stop();
  });
});
