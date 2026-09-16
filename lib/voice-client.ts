import {
  VoiceCloseSchema,
  VoiceEventSchema,
  VoiceFragmentSchema,
  VoiceOfferSchema,
  VoiceStatusSchema,
  initialVoiceView,
  type ConversationTurn,
  type DesignFact,
  type VoiceOffer,
  type VoiceView,
} from "@/types";
import liveInstructions from "@/profiles/live-instructions.md?raw";
import { PROFILE } from "./profile";
import { RUNTIME_URL } from "./runtime-url";

class VoiceHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly allocationStatus: "rejected" | "unknown",
  ) {
    super(message);
  }
}

const abortError = () => new DOMException("Live call cancelled", "AbortError");

async function voiceRequest(path: string, method = "GET", body?: unknown): Promise<unknown> {
  const res = await fetch(`${RUNTIME_URL}/api/voice/${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(50_000),
  });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok)
    throw new VoiceHttpError(
      typeof json?.detail === "string" ? json.detail : `Live request failed (HTTP ${res.status})`,
      res.status,
      json?.allocation_status === "rejected" ? "rejected" : "unknown",
    );
  return json;
}

/**
 * The runtime's SSE event stream for a call. EventSource handles framing and
 * reconnects; the explicit `after` cursor is the runtime's replay contract.
 */
function observeVoiceEvents(
  callId: string,
  receive: (id: number, data: unknown) => void,
  failed: () => void,
): () => void {
  let source: EventSource | undefined;
  let cursor = 0;
  let attempts = 0;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const connect = () => {
    if (stopped) return;
    source = new EventSource(`${RUNTIME_URL}/api/voice/calls/${encodeURIComponent(callId)}/events?after=${cursor}`);
    source.onmessage = (event) => {
      const id = Number(event.lastEventId);
      if (!Number.isSafeInteger(id) || id <= cursor) return;
      try {
        receive(id, JSON.parse(event.data));
        cursor = id;
        attempts = 0;
      } catch {
        stopped = true;
        source?.close();
        failed();
      }
    };
    source.onerror = () => {
      source?.close();
      if (stopped) return;
      if (++attempts > 3) {
        stopped = true;
        failed();
        return;
      }
      retry = setTimeout(connect, 1000 * attempts);
    };
  };
  connect();
  return () => {
    stopped = true;
    clearTimeout(retry);
    source?.close();
  };
}

/**
 * One live call: the microphone, the WebRTC audio to GPT-Live, the runtime's
 * event stream and the data channel for quiet application facts. The call is
 * created with this app's profile and its Live persona (profiles/
 * live-instructions.md), so the runtime needs no startup prompt for it. The
 * voice machine observes `subscribe` and drives `start`, `toggleMic`,
 * `sendFact` and `end`. No provider command is sent except the allowed appends.
 */
export class VoiceClient {
  private view = initialVoiceView();
  private listeners = new Set<(view: VoiceView) => void>();
  private peer?: RTCPeerConnection;
  private media?: MediaStream;
  private audio?: HTMLAudioElement;
  private channel?: RTCDataChannel;
  private stopEvents?: () => void;
  private callId = "";
  private allocation?: Promise<VoiceOffer>;
  private closing?: Promise<void>;
  private ending = false;
  private disposed = false;
  private eventCursor = 0;
  private disconnectTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly sessionId: string,
    private readonly history: ConversationTurn[],
  ) {}

  snapshot = (): VoiceView => structuredClone(this.view);

  subscribe = (listener: (view: VoiceView) => void) => {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  };

  private update(values: Partial<VoiceView>) {
    Object.assign(this.view, values);
    for (const listener of this.listeners) listener(this.snapshot());
  }

  private failure = (message: string) => {
    if (!this.ending) this.update({ fatal: message });
  };

  private check() {
    if (this.ending) throw abortError();
  }

  async start(): Promise<void> {
    const status = VoiceStatusSchema.parse(await voiceRequest("status"));
    this.check();
    if (!status.enabled) throw new Error("Live voice is not enabled in the runtime (VOICE__ENABLED).");
    if (!status.configured)
      throw new Error("Live voice needs an OpenAI API key in the runtime's environment.");
    if (status.conversation_mode_supported !== true)
      throw new Error("This runtime does not support conversation-only voice calls.");
    if (status.call_instructions_supported !== true)
      throw new Error("This runtime does not take the Live persona per call; update assistant-runtime.");
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.RTCPeerConnection)
      throw new Error("This browser cannot start live audio; use a current browser on localhost or HTTPS.");

    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      throw new Error(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Microphone access was denied. Allow it in the browser and try again."
          : "The microphone could not be opened.",
      );
    }
    if (this.ending) {
      media.getTracks().forEach((t) => t.stop());
      throw abortError();
    }
    this.media = media;
    for (const track of media.getAudioTracks()) track.enabled = false;

    const peer = new RTCPeerConnection();
    this.peer = peer;
    window.addEventListener("pagehide", this.leave);
    this.audio = new Audio();
    this.audio.autoplay = true;
    peer.ontrack = (event) => {
      if (this.ending || !this.audio) return;
      this.audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      this.playSound();
    };
    peer.onconnectionstatechange = () => {
      clearTimeout(this.disconnectTimer);
      if (this.ending) return;
      if (peer.connectionState === "failed" || peer.connectionState === "closed")
        this.failure("The live audio connection ended unexpectedly.");
      if (peer.connectionState === "disconnected")
        this.disconnectTimer = setTimeout(() => this.failure("The live audio connection was lost."), 10_000);
    };
    for (const track of media.getTracks()) {
      track.addEventListener("ended", () => {
        if (!this.ending) this.failure("The microphone disconnected.");
      });
      peer.addTrack(track, media);
    }

    const channel = peer.createDataChannel("oai-events");
    this.channel = channel;
    let providerStarted = false;
    channel.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { type?: string };
        if (data.type === "session.started") providerStarted = true;
      } catch {
        /* provider data is observed, never executed */
      }
    };

    await peer.setLocalDescription(await peer.createOffer());
    await this.waitFor(() => peer.iceGatheringState === "complete", peer, "icegatheringstatechange", 12_000);
    this.check();
    const sdp = peer.localDescription?.sdp;
    if (!sdp) throw new Error("The browser did not create an audio offer.");

    // The allocation stays observable after a cancel so a late call can be closed.
    this.allocation = voiceRequest("calls", "POST", {
      session_id: this.sessionId,
      sdp,
      mode: "conversation",
      profile: PROFILE,
      instructions: liveInstructions,
      history: this.history,
    }).then((body) => VoiceOfferSchema.parse(body));
    const offer = await this.allocation;
    this.callId = offer.call_id;
    this.update({ callId: offer.call_id });
    this.check();

    this.stopEvents = observeVoiceEvents(
      this.callId,
      (id, data) => this.receive(data, id),
      () => this.failure("The live event stream could not recover; ending the call."),
    );
    await peer.setRemoteDescription({ type: "answer", sdp: offer.transport.sdp });
    await this.waitFor(() => peer.connectionState === "connected", peer, "connectionstatechange", 20_000);
    await this.waitFor(() => providerStarted, channel, "message", 10_000);
    await this.waitFor(() => channel.readyState === "open", channel, "open", 10_000);
    this.check();
    for (const track of media.getAudioTracks()) track.enabled = !this.view.micMuted;
  }

  private waitFor(check: () => boolean, target: EventTarget, event: string, timeout: number) {
    if (check()) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer);
        target.removeEventListener(event, changed);
      };
      const changed = () => {
        if (this.ending) {
          finish();
          reject(abortError());
        } else if (check()) {
          finish();
          resolve();
        }
      };
      const timer = setTimeout(() => {
        finish();
        reject(new Error("The live audio connection timed out."));
      }, timeout);
      target.addEventListener(event, changed);
      changed();
    });
  }

  playSound = () => {
    if (!this.audio || this.ending) return;
    void this.audio
      .play()
      .then(() => this.update({ soundBlocked: false }))
      .catch(() => this.update({ soundBlocked: true }));
  };

  toggleMic = () => {
    if (!this.media || this.ending) return;
    const muted = !this.view.micMuted;
    this.media.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    this.update({ micMuted: muted });
  };

  /**
   * A bounded application fact on the allowed `session.thinking.append`
   * channel: not user speech, not a request for a reply.
   */
  sendFact = (fact: DesignFact) => {
    if (!this.channel || this.channel.readyState !== "open" || this.ending) return;
    try {
      this.channel.send(
        JSON.stringify({
          type: "session.thinking.append",
          event_id: `design-${crypto.randomUUID()}`,
          delegation_id: null,
          content: JSON.stringify({ source: "design-studio", ...fact }),
        }),
      );
    } catch {
      this.update({ warning: "Live did not receive the last document update." });
    }
  };

  receive(raw: unknown, cursor?: number) {
    const envelope = VoiceEventSchema.parse(raw);
    if (envelope.call_id !== this.callId) return;
    if (cursor !== undefined) {
      if (cursor <= this.eventCursor) return;
      this.eventCursor = cursor;
    }
    const { event, data } = envelope;
    if (event === "transcript") {
      const fragment = VoiceFragmentSchema.parse(data);
      const fragments = [...this.view.fragments, fragment];
      this.update({
        fragments,
        lastUserFragment:
          fragment.role === "user" && fragment.delta.trim() ? fragments.length - 1 : this.view.lastUserFragment,
      });
    } else if (event === "snapshot") {
      const fragments = Array.isArray(data.transcript)
        ? data.transcript.map((item) => VoiceFragmentSchema.parse(item))
        : this.view.fragments;
      this.update({ fragments, lastUserFragment: fragments.findLastIndex((f) => f.role === "user") });
      this.applyStatus(data);
    } else if (event === "status") this.applyStatus(data);
    else if (event === "usage") this.update({ finalized: data.finalized === true || this.view.finalized });
    else if (event === "provider_error")
      this.update({ warning: "The voice service reported an error; keep talking or end the call." });
  }

  private applyStatus(data: Record<string, unknown>) {
    if (data.status === "closed" || data.status === "interrupted")
      this.update({
        remoteClosed: true,
        finalized: data.finalized === true || this.view.finalized,
        warning:
          data.status === "interrupted" ? "The voice session ended without confirmed finalization." : this.view.warning,
      });
  }

  private leave = () => {
    this.ending = true;
    if (this.callId)
      void fetch(`${RUNTIME_URL}/api/voice/calls/${encodeURIComponent(this.callId)}/close`, {
        method: "POST",
        keepalive: true,
      }).catch(() => undefined);
    this.disposeMedia();
  };

  /** Stop local audio at once, then ask the runtime to close and confirm. */
  end = (): Promise<void> => {
    if (this.closing) return this.closing;
    this.ending = true;
    this.media?.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
    if (this.audio) this.audio.muted = true;
    this.closing = (async () => {
      try {
        if (this.allocation && !this.callId) {
          try {
            this.callId = (await this.allocation).call_id;
          } catch (error) {
            // Only an explicit rejection proves no provider call exists.
            if (!(error instanceof VoiceHttpError && error.allocationStatus === "rejected"))
              throw new Error("Live setup could not be confirmed; check the runtime before starting another call.");
          }
        }
        if (this.callId) {
          const result = VoiceCloseSchema.parse(
            await voiceRequest(`calls/${encodeURIComponent(this.callId)}/close`, "POST"),
          );
          this.update({ finalized: result.finalized === true });
          if (!result.finalized)
            throw new Error("Audio stopped, but the provider did not confirm the call ended; check the runtime.");
        }
      } finally {
        this.disposeMedia();
      }
    })();
    return this.closing;
  };

  private disposeMedia() {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener("pagehide", this.leave);
    clearTimeout(this.disconnectTimer);
    this.stopEvents?.();
    this.media?.getTracks().forEach((track) => track.stop());
    this.peer?.close();
    this.audio?.pause();
    if (this.audio) this.audio.srcObject = null;
  }
}
