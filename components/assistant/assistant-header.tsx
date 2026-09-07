"use client";

import { X, Sparkles, BookOpenText } from "lucide-react";
import type { ConnectionStatus, UsageTotals } from "@/types";
import { cn } from "@/lib/utils";

interface AssistantHeaderProps {
  title: string | null;
  connection: ConnectionStatus;
  totals: UsageTotals;
  styleGuideOpen: boolean;
  onToggleStyleGuide: () => void;
  onClose: () => void;
}

const CONNECTION_STYLE: Record<ConnectionStatus, { dot: string; label: string }> = {
  connected: { dot: "bg-one-green", label: "Connected to the runtime" },
  connecting: { dot: "bg-one-yellow animate-pulse", label: "Connecting to the runtime…" },
  disconnected: { dot: "bg-one-red", label: "Runtime unreachable; retrying" },
};

function formatTotals(t: UsageTotals): string | null {
  if (t.turns === 0) return null;
  const tokens = `${t.inputTokens + t.outputTokens} tokens`;
  return t.costUsd == null ? tokens : `${tokens} · $${t.costUsd.toFixed(4)}`;
}

export function AssistantHeader({
  title,
  connection,
  totals,
  styleGuideOpen,
  onToggleStyleGuide,
  onClose,
}: AssistantHeaderProps) {
  const conn = CONNECTION_STYLE[connection];
  const totalsLabel = formatTotals(totals);
  return (
    <div className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-3">
      <div className="flex min-w-0 items-center gap-2">
        <Sparkles className="h-4 w-4 shrink-0 text-primary" />
        <span className="truncate text-sm font-medium text-accent-foreground">
          {title ?? "Assistant"}
        </span>
        <span
          className={cn("ml-1 inline-block h-2 w-2 shrink-0 rounded-full", conn.dot)}
          title={conn.label}
        />
      </div>
      <div className="flex items-center gap-2">
        {totalsLabel && (
          <span className="font-mono text-[10px] text-muted-foreground" title="Session usage">
            {totalsLabel}
          </span>
        )}
        <button
          onClick={onToggleStyleGuide}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:text-accent-foreground",
            styleGuideOpen ? "bg-accent text-accent-foreground" : "text-muted-foreground",
          )}
          title="Assistant style guide and artifacts"
        >
          <BookOpenText className="h-4 w-4" />
        </button>
        <button
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-accent-foreground"
          title="Hide the assistant"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
