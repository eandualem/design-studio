"use client";

import { useEffect, useRef } from "react";
import { AlertCircle, Loader2, Mic, MicOff, PhoneOff, Square, Volume2 } from "lucide-react";
import type { DesignDecision, VoiceMessage } from "@/types";
import { ControllerPhase } from "@/hooks/useDesignControllerContext";
import { VoicePhase } from "@/hooks/useVoiceContext";
import { designModelLabel } from "@/lib/design-model";
import { cn } from "@/lib/utils";

interface LivePanelProps {
  phase: VoicePhase;
  micMuted: boolean;
  soundBlocked: boolean;
  transcript: VoiceMessage[];
  warning: string;
  error: string | null;
  controllerPhase: ControllerPhase;
  lastDecision: DesignDecision | null;
  designModel: string;
  onStart: () => void;
  onEnd: () => void;
  onMute: () => void;
  onPlay: () => void;
  onStopController: () => void;
}

const CONTROLLER_LABEL: Record<ControllerPhase, string> = {
  [ControllerPhase.Idle]: "",
  [ControllerPhase.Listening]: "listening",
  [ControllerPhase.Waiting]: "heard you…",
  [ControllerPhase.Deciding]: "deciding…",
  [ControllerPhase.Executing]: "editing…",
};

function describeDecision(d: DesignDecision): string {
  const seconds = (from: number, to: number | null) => (to === null ? null : `${((to - from) / 1000).toFixed(1)} s`);
  switch (d.status) {
    case "deciding":
      return "deciding…";
    case "held":
      return `held · ${seconds(d.requestedAt, d.returnedAt)}`;
    case "executing":
      return `${d.action} · ${seconds(d.requestedAt, d.returnedAt)}`;
    case "applied":
      return `${d.action} · ${seconds(d.utteranceAt, d.appliedAt)} after you spoke${d.detail ? ` · ${d.detail}` : ""}`;
    case "failed":
      return `failed · ${d.detail ?? ""}`;
    case "cancelled":
      return "stopped";
  }
}

function IconButton({
  title,
  onClick,
  tone = "muted",
  children,
}: {
  title: string;
  onClick: () => void;
  tone?: "muted" | "red" | "primary";
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:opacity-80",
        tone === "red" && "bg-one-red/15 text-one-red",
        tone === "primary" && "bg-primary/15 text-primary",
        tone === "muted" && "bg-accent text-accent-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Live voice: Talk live when idle; during a call, the spoken transcript, the
 * controls and one line about what the design controller is doing.
 */
export function LivePanel({
  phase,
  micMuted,
  soundBlocked,
  transcript,
  warning,
  error,
  controllerPhase,
  lastDecision,
  designModel,
  onStart,
  onEnd,
  onMute,
  onPlay,
  onStopController,
}: LivePanelProps) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [transcript]);

  if (phase === VoicePhase.Idle) {
    return (
      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <button
          onClick={onStart}
          className="flex items-center gap-1.5 rounded-md bg-primary/15 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:opacity-80"
          title="Start a live voice call; the design controller draws while you talk"
        >
          <Mic className="h-3.5 w-3.5" />
          Talk live
        </button>
        {error && (
          <span className="flex min-w-0 items-center gap-1 text-xs text-one-red">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate" title={error}>
              {error}
            </span>
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex max-h-[45%] shrink-0 flex-col border-t border-border">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-accent-foreground">
          {phase === VoicePhase.Active ? (
            <span className="inline-block h-2 w-2 rounded-full bg-one-green" />
          ) : (
            <Loader2 className="h-3 w-3 animate-spin text-one-yellow" />
          )}
          {phase === VoicePhase.Connecting ? "Connecting…" : phase === VoicePhase.Closing ? "Ending…" : "Live"}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={warning || undefined}>
          {warning}
        </span>
        {phase === VoicePhase.Active && soundBlocked && (
          <IconButton title="Enable sound" onClick={onPlay} tone="primary">
            <Volume2 className="h-4 w-4" />
          </IconButton>
        )}
        {phase === VoicePhase.Active && (
          <IconButton title={micMuted ? "Unmute" : "Mute"} onClick={onMute}>
            {micMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </IconButton>
        )}
        {phase === VoicePhase.Active && (
          <IconButton title="Stop the design controller's current decision" onClick={onStopController}>
            <Square className="h-3.5 w-3.5" />
          </IconButton>
        )}
        {phase !== VoicePhase.Closing && (
          <IconButton title="End the call" onClick={onEnd} tone="red">
            <PhoneOff className="h-4 w-4" />
          </IconButton>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        {transcript.length === 0 ? (
          <p className="text-xs text-muted-foreground">Say what you are designing; the document follows.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {transcript.map((m) => (
              <li key={m.id} className={cn(m.role === "user" ? "text-foreground" : "text-muted-foreground")}>
                <span className="mr-1 font-medium">{m.role === "user" ? "You" : "Live"}</span>
                {m.content}
              </li>
            ))}
          </ul>
        )}
        <div ref={endRef} />
      </div>
      <div
        className="flex items-center gap-2 border-t border-border/60 px-3 py-1 font-mono text-[10px] text-muted-foreground"
        title="The design controller: one decision per utterance, in parallel with the voice"
      >
        <span className="shrink-0">controller · {designModelLabel(designModel) || "runtime default"}</span>
        <span className="min-w-0 flex-1 truncate">
          {lastDecision ? describeDecision(lastDecision) : CONTROLLER_LABEL[controllerPhase]}
          {lastDecision && controllerPhase !== ControllerPhase.Listening && lastDecision.status !== "deciding"
            ? ` · ${CONTROLLER_LABEL[controllerPhase]}`
            : ""}
        </span>
      </div>
    </div>
  );
}
