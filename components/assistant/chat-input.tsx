"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Send, Square, Loader2, ImagePlus, X, GitBranch, MessageSquareDashed } from "lucide-react";
import type { AttachmentPreview } from "@/types";
import { readImageFile } from "@/lib/attachments";
import { cn } from "@/lib/utils";

export interface Draft {
  text: string;
  /** Set when the draft branches from an earlier point of the conversation. */
  branch: { parentId: string | null; label: string } | null;
}

interface ChatInputProps {
  draft: Draft;
  onDraftChange: (draft: Draft) => void;
  onSend: (text: string, attachments: AttachmentPreview[], parentId: string | null | undefined) => void;
  onSteer: (text: string) => void;
  onCancel: () => void;
  onAttachError: (message: string) => void;
  isStreaming: boolean;
  isCancelling: boolean;
  disabled?: boolean;
}

export function ChatInput({
  draft,
  onDraftChange,
  onSend,
  onSteer,
  onCancel,
  onAttachError,
  isStreaming,
  isCancelling,
  disabled,
}: ChatInputProps) {
  const [attachments, setAttachments] = useState<AttachmentPreview[]>([]);
  const [dragging, setDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const text = draft.text;
  const setText = useCallback((t: string) => onDraftChange({ ...draft, text: t }), [draft, onDraftChange]);
  const steering = isStreaming && !isCancelling;

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled || isCancelling) return;
    if (steering) {
      onSteer(trimmed);
    } else {
      onSend(trimmed, attachments, draft.branch ? draft.branch.parentId : undefined);
      setAttachments([]);
    }
    onDraftChange({ text: "", branch: null });
  }, [text, disabled, isCancelling, steering, onSteer, onSend, attachments, draft.branch, onDraftChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
      if (e.key === "Escape" && draft.branch) onDraftChange({ text: "", branch: null });
    },
    [handleSubmit, draft.branch, onDraftChange],
  );

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        try {
          const preview = await readImageFile(file);
          setAttachments((prev) => [...prev, preview]);
        } catch (error) {
          onAttachError(error instanceof Error ? error.message : String(error));
        }
      }
    },
    [onAttachError],
  );

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  useEffect(() => {
    if (draft.branch) textareaRef.current?.focus();
  }, [draft.branch]);

  return (
    <div
      className="border-t border-border p-3"
      onDragOver={(e) => {
        if (steering) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!steering) void addFiles(e.dataTransfer.files);
      }}
    >
      {draft.branch && (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-one-magenta/30 bg-one-magenta/5 px-2 py-1 text-[11px] text-one-magenta">
          <GitBranch className="h-3 w-3 shrink-0" />
          <span className="min-w-0 flex-1 truncate">Variant of: {draft.branch.label}</span>
          <button onClick={() => onDraftChange({ text: "", branch: null })} className="rounded p-0.5 hover:bg-accent" title="Cancel the variant">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
      {steering && (
        <div className="mb-2 flex items-center gap-2 text-[11px] text-one-yellow">
          <MessageSquareDashed className="h-3 w-3" /> The assistant is working; a message now nudges it mid-turn.
        </div>
      )}
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attachments.map((a, i) => (
            <span key={`${a.name}-${i}`} className="group relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.dataUri} alt={a.name} title={a.name} className="h-14 rounded-md border border-border object-cover" />
              <button
                onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                className="absolute -right-1 -top-1 rounded-full bg-background p-0.5 text-muted-foreground shadow hover:text-one-red"
                title="Remove"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div
        className={cn(
          "flex items-end gap-2 rounded-lg border bg-muted px-3 py-2 transition-colors",
          dragging ? "border-primary" : steering ? "border-one-yellow/50" : "border-border",
        )}
      >
        <button
          onClick={() => fileRef.current?.click()}
          disabled={disabled || steering}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-accent-foreground disabled:opacity-30"
          title="Attach an image (or drop one here)"
        >
          <ImagePlus className="h-4 w-4" />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            disabled ? "Open a document to chat" : steering ? "Nudge the assistant…" : "Send a message…"
          }
          rows={1}
          disabled={disabled}
          className="flex-1 resize-none bg-transparent text-sm text-accent-foreground outline-none placeholder:text-muted-foreground"
          style={{ maxHeight: "120px" }}
        />
        {steering && (
          <button
            onClick={handleSubmit}
            disabled={!text.trim()}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-one-yellow/15 text-one-yellow transition-colors hover:opacity-80 disabled:opacity-30"
            title="Send the nudge"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        )}
        {isStreaming ? (
          <button
            onClick={onCancel}
            disabled={isCancelling}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-one-red/15 text-one-red transition-colors hover:opacity-80 disabled:opacity-50"
            title={isCancelling ? "Cancelling…" : "Stop generating"}
          >
            {isCancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!text.trim() || disabled}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary transition-colors hover:opacity-80 disabled:opacity-30"
            title="Send message"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
