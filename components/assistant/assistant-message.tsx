"use client";

import { Sparkles, AlertTriangle, Ban, Hand } from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import type { AssistantMessageRecord, Usage } from "@/types";
import { useStreamingText } from "@/hooks/useStreamingText";
import { ThinkingIndicator } from "./thinking-indicator";
import { ToolExecutionGroup } from "./tool-execution-group";

function TextSegment({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  const displayed = useStreamingText(text, isStreaming);
  return (
    <div className="whitespace-pre-wrap text-sm leading-relaxed text-accent-foreground">
      {displayed}
      {isStreaming && (
        <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-primary" />
      )}
    </div>
  );
}

function formatUsage(usage: Usage): string {
  const parts = [`${usage.input_tokens ?? 0} in / ${usage.output_tokens ?? 0} out`];
  if (usage.cost_usd != null) parts.push(`$${usage.cost_usd.toFixed(4)}`);
  return parts.join(" · ");
}

const ERROR_LABELS: Record<string, { label: string; hint: string | null }> = {
  cancelled: { label: "Cancelled", hint: "The text above was kept." },
  usage_limit: { label: "Usage limit reached", hint: "This turn cannot be retried; the partial answer was saved." },
  forbidden: { label: "Not allowed", hint: "This session belongs to someone else." },
  session_error: { label: "Session error", hint: "The runtime rejected the request for this session." },
  setup_error: { label: "Runtime setup error", hint: "The runtime could not start a model; check its provider configuration." },
  validation: { label: "Rejected by the runtime", hint: "The message or host context did not validate." },
  timeout: { label: "The model did not answer in time", hint: "Send the message again." },
  internal: { label: "Runtime error", hint: "Send the message again; if it repeats, check the runtime log." },
};

function describeError(error: NonNullable<AssistantMessageRecord["error"]>): { label: string; hint: string | null } {
  const known = ERROR_LABELS[error.errorType];
  if (known) return known;
  const label = error.errorType.replace(/_/g, " ");
  return {
    label: label.charAt(0).toUpperCase() + label.slice(1),
    hint: error.retryAllowed === false ? "Not retryable." : "Provider error; try again.",
  };
}

function ErrorNote({ error }: { error: NonNullable<AssistantMessageRecord["error"]> }) {
  const cancelled = error.errorType === "cancelled";
  const Icon = cancelled ? Ban : AlertTriangle;
  const described = describeError(error);
  return (
    <div
      className={
        cancelled
          ? "mt-2 flex items-start gap-2 rounded-md border border-one-yellow/30 bg-one-yellow/5 px-3 py-2 text-xs text-one-yellow"
          : "mt-2 flex items-start gap-2 rounded-md border border-one-red/30 bg-one-red/5 px-3 py-2 text-xs text-one-red"
      }
    >
      <Icon className="mt-px h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0">
        <div className="font-medium">{described.label}</div>
        {error.message && (
          <div className="mt-0.5 break-words opacity-90">{error.message}</div>
        )}
        {described.hint && <div className="mt-0.5 opacity-70">{described.hint}</div>}
      </div>
    </div>
  );
}

interface AssistantMessageProps {
  message: AssistantMessageRecord;
  awaitingHostAction: boolean;
  queuedActions: number;
}

export function AssistantMessage({ message, awaitingHostAction, queuedActions }: AssistantMessageProps) {
  return (
    <div className="flex gap-2.5">
      <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <AnimatePresence>
          {message.segments.map((seg, i) => {
            const isLast = i === message.segments.length - 1;
            return (
              <m.div
                key={seg.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
              >
                {seg.kind === "thinking" && (
                  <ThinkingIndicator
                    thinking={seg.block}
                    isStreaming={message.isStreaming && isLast}
                  />
                )}
                {seg.kind === "tool_group" && (
                  <ToolExecutionGroup
                    group={seg.group}
                    isStreaming={message.isStreaming && isLast}
                  />
                )}
                {seg.kind === "text" && (
                  <TextSegment
                    text={seg.text}
                    isStreaming={message.isStreaming && isLast}
                  />
                )}
              </m.div>
            );
          })}
        </AnimatePresence>

        {message.isStreaming && message.segments.length === 0 && (
          <div className="flex items-center gap-1 py-1 text-sm text-muted-foreground">
            <span className="thinking-dots flex gap-[2px]">
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
            </span>
          </div>
        )}

        {awaitingHostAction && (
          <div className="mt-2 flex items-center gap-2 text-xs text-primary">
            <Hand className="h-3.5 w-3.5" />
            Performing the requested action…
            {queuedActions > 0 && (
              <span className="text-muted-foreground">
                {queuedActions} more action{queuedActions === 1 ? "" : "s"} queued
              </span>
            )}
          </div>
        )}

        {message.error && <ErrorNote error={message.error} />}

        {(message.usage || message.model) && (
          <div className="mt-2 flex items-center gap-3 font-mono text-[10px] text-muted-foreground">
            {message.usage && <span>{formatUsage(message.usage)}</span>}
            {message.model && message.model !== "unknown" && (
              <span className="truncate">{message.model}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
