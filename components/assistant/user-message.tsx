"use client";

import { User, GitBranch, ChevronLeft, ChevronRight } from "lucide-react";
import type { UserMessageRecord, VariantInfo } from "@/types";

interface UserMessageProps {
  message: UserMessageRecord;
  variant: VariantInfo | null;
  canBranch: boolean;
  onTryVariant: (message: UserMessageRecord) => void;
  onSelectVariant: (leafId: string) => void;
}

export function UserMessage({ message, variant, canBranch, onTryVariant, onSelectVariant }: UserMessageProps) {
  const isSteering = message.messageType === "steering";
  return (
    <div className="group flex justify-end gap-2.5">
      <div className="flex max-w-[85%] flex-col items-end gap-1">
        <div className={isSteering ? "rounded-lg border border-one-yellow/40 bg-one-yellow/10 px-3 py-2" : "rounded-lg bg-one-blue/20 px-3 py-2"}>
          {message.attachments && message.attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap justify-end gap-1.5">
              {message.attachments.map((a, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={`${a.name}-${i}`}
                  src={a.dataUri}
                  alt={a.name}
                  title={a.name}
                  className="h-20 max-w-[160px] rounded-md border border-border object-cover"
                />
              ))}
            </div>
          )}
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-accent-foreground">{message.text}</p>
          <div className="mt-1 flex items-center justify-end gap-2">
            {isSteering && (
              <span className="text-[10px] uppercase tracking-wider text-one-yellow">nudge</span>
            )}
            <span className="text-[10px] text-muted-foreground">
              {new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}
            </span>
          </div>
        </div>
        {!isSteering && (
          <div className="flex h-5 items-center gap-2 text-[10px] text-muted-foreground">
            {variant && (
              <span className="flex items-center gap-0.5" title="Variants of this message">
                <button
                  onClick={() => onSelectVariant(variant.leafIds[variant.index - 2])}
                  disabled={variant.index <= 1}
                  className="rounded p-0.5 hover:text-accent-foreground disabled:opacity-30"
                  title="Previous variant"
                >
                  <ChevronLeft className="h-3 w-3" />
                </button>
                <span className="font-mono">
                  {variant.index}/{variant.count}
                </span>
                <button
                  onClick={() => onSelectVariant(variant.leafIds[variant.index])}
                  disabled={variant.index >= variant.count}
                  className="rounded p-0.5 hover:text-accent-foreground disabled:opacity-30"
                  title="Next variant"
                >
                  <ChevronRight className="h-3 w-3" />
                </button>
              </span>
            )}
            {canBranch && (
              <button
                onClick={() => onTryVariant(message)}
                className="flex items-center gap-1 rounded px-1 opacity-0 transition-opacity hover:text-accent-foreground group-hover:opacity-100"
                title="Send a different message from this point"
              >
                <GitBranch className="h-3 w-3" /> Try a variant
              </button>
            )}
          </div>
        )}
      </div>
      <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent">
        <User className="h-3.5 w-3.5 text-foreground" />
      </div>
    </div>
  );
}
