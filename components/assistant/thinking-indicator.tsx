"use client";

import { useState } from "react";
import { Brain } from "lucide-react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { AnimatePresence, m } from "motion/react";
import type { ThinkingBlock } from "@/types";
import { cn } from "@/lib/utils";

interface ThinkingIndicatorProps {
  thinking: ThinkingBlock;
  isStreaming: boolean;
}

export function ThinkingIndicator({ thinking, isStreaming }: ThinkingIndicatorProps) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <div className="my-2 overflow-hidden rounded-md border border-border bg-muted">
        <Collapsible.Trigger asChild>
          <button className="flex w-full items-center gap-1.5 px-3 py-2 text-left transition-opacity hover:opacity-80">
            <Brain
              className={cn("h-3 w-3 shrink-0 text-one-magenta", isStreaming && "animate-pulse")}
            />
            <span className="text-[10px] font-medium uppercase tracking-wider text-one-magenta">
              {isStreaming ? "Thinking" : "Thought"}
            </span>
            {isStreaming && (
              <span className="thinking-dots ml-0.5 flex gap-[2px]">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
              </span>
            )}
            <m.span
              className="ml-auto inline-flex h-3 w-3 items-center justify-center text-[10px] text-muted-foreground"
              animate={{ rotate: open ? 0 : -90 }}
              transition={{ duration: 0.15 }}
            >
              ▼
            </m.span>
          </button>
        </Collapsible.Trigger>
        <AnimatePresence initial={false}>
          {open && (
            <m.div
              key="thinking-content"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              style={{ overflow: "hidden" }}
            >
              <div className="px-3 pb-2">
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                  {thinking.text}
                  {isStreaming && (
                    <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse rounded-sm bg-one-magenta" />
                  )}
                </p>
              </div>
            </m.div>
          )}
        </AnimatePresence>
      </div>
    </Collapsible.Root>
  );
}
