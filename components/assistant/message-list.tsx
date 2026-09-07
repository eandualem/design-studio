"use client";

import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { MessageRecord, UserMessageRecord, VariantInfo } from "@/types";
import { UserMessage } from "./user-message";
import { AssistantMessage } from "./assistant-message";

interface MessageListProps {
  messages: MessageRecord[];
  variants: Record<string, VariantInfo>;
  awaitingHostAction: boolean;
  queuedActions: number;
  canBranch: boolean;
  onTryVariant: (message: UserMessageRecord) => void;
  onSelectVariant: (leafId: string) => void;
}

export function MessageList({
  messages,
  variants,
  awaitingHostAction,
  queuedActions,
  canBranch,
  onTryVariant,
  onSelectVariant,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const viewport = bottomRef.current?.closest("[data-radix-scroll-area-viewport]");
    if (!(viewport instanceof HTMLElement)) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: messages.length > 1 ? "smooth" : "auto" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">No messages yet</p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            Ask for a diagram, or describe the system you are designing
          </p>
        </div>
      </div>
    );
  }

  const lastId = messages[messages.length - 1]?.id;

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-4 p-4">
        {messages.map((msg) =>
          msg.kind === "user" ? (
            <UserMessage
              key={msg.id}
              message={msg}
              variant={variants[msg.id] ?? null}
              canBranch={canBranch && msg.parentId !== null}
              onTryVariant={onTryVariant}
              onSelectVariant={onSelectVariant}
            />
          ) : (
            <AssistantMessage
              key={msg.id}
              message={msg}
              awaitingHostAction={awaitingHostAction && msg.id === lastId}
              queuedActions={queuedActions}
            />
          ),
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
