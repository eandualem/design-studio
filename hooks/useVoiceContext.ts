"use client";

import { useCallback, useMemo } from "react";
import { useSelector } from "@xstate/react";
import { convertStateToString } from "@/lib/stateToStr";
import { liveMessages, seedHistory } from "@/lib/voice-transcript";
import { useAppContext } from "./useAppContext";

export enum VoicePhase {
  Idle = "Idle",
  Connecting = "Connecting",
  Active = "Active",
  Closing = "Closing",
}

const phaseMap: Record<string, VoicePhase> = {
  idle: VoicePhase.Idle,
  "call.connecting": VoicePhase.Connecting,
  "call.active": VoicePhase.Active,
  "call.closing": VoicePhase.Closing,
};

export const useVoiceContext = () => {
  const {
    data: { voiceRef, assistantRef },
  } = useAppContext();

  const stateValue = useSelector(voiceRef, (s) => s.value);
  const callId = useSelector(voiceRef, (s) => s.context.view.callId);
  const fragments = useSelector(voiceRef, (s) => s.context.view.fragments);
  const micMuted = useSelector(voiceRef, (s) => s.context.view.micMuted);
  const soundBlocked = useSelector(voiceRef, (s) => s.context.view.soundBlocked);
  const warning = useSelector(voiceRef, (s) => s.context.view.warning);
  const error = useSelector(voiceRef, (s) => s.context.error);

  const phase = useMemo(() => phaseMap[convertStateToString(stateValue)] ?? VoicePhase.Idle, [stateValue]);
  const transcript = useMemo(() => liveMessages(callId, fragments), [callId, fragments]);

  const start = useCallback(() => {
    const history = seedHistory(assistantRef.getSnapshot().context.messages);
    voiceRef.send({ type: "user.start", history });
  }, [voiceRef, assistantRef]);
  const end = useCallback(() => voiceRef.send({ type: "user.end" }), [voiceRef]);
  const mute = useCallback(() => voiceRef.send({ type: "user.mute" }), [voiceRef]);
  const play = useCallback(() => voiceRef.send({ type: "user.play" }), [voiceRef]);

  return {
    state: { phase, micMuted, soundBlocked },
    data: { transcript, warning, error },
    actions: { call: { start, end, mute, play } },
  };
};

export type VoiceData = ReturnType<typeof useVoiceContext>["data"];
export type VoiceActions = ReturnType<typeof useVoiceContext>["actions"];
