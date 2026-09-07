"use client";

import { useState } from "react";
import { FileText, PenTool, Loader2, Plus, Trash2, Files } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFilesContext } from "@/hooks/useFilesContext";
import type { FilesActions, FilesData } from "@/hooks/useFilesContext";

interface DocumentRowProps {
  doc: FilesData["documents"][number];
  active: boolean;
  onOpen: FilesActions["open"]["document"];
  onDelete: FilesActions["submit"]["delete"];
  onRename: FilesActions["submit"]["rename"];
}

function DocumentRow({ doc, active, onOpen, onDelete, onRename }: DocumentRowProps) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft !== null && draft.trim() && draft.trim() !== doc.name) onRename(doc.id, draft);
    setDraft(null);
  };

  return (
    <div
      className={cn(
        "group relative flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:text-sidebar-accent-foreground",
      )}
      onClick={() => onOpen(doc.id)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setDraft(doc.name);
      }}
      title="Double-click to rename"
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-primary" />
      )}
      <FileText className={cn("h-4 w-4 shrink-0", active && "text-primary")} />
      {draft === null ? (
        <span className="min-w-0 flex-1 truncate">{doc.name}</span>
      ) : (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setDraft(null);
          }}
          onClick={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 rounded border border-border bg-background px-1 text-xs text-accent-foreground outline-none"
        />
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete(doc.id);
        }}
        className="shrink-0 rounded p-0.5 text-one-red opacity-0 transition-opacity hover:opacity-80 group-hover:opacity-100"
        title="Delete document"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

export function AppSidebar() {
  const { state, data, actions } = useFilesContext();

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <button
        className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4 text-left"
        onClick={actions.open.list}
        title="All documents"
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
          <PenTool className="h-4 w-4 text-primary-foreground" />
        </div>
        <span className="text-sm font-semibold text-accent-foreground">Design Studio</span>
      </button>
      <div className="flex items-center justify-between px-4 pb-1 pt-3">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Documents
        </span>
        <button
          onClick={actions.submit.create}
          disabled={state.isBusy}
          className="flex h-5 w-5 items-center justify-center rounded text-primary hover:bg-sidebar-accent disabled:opacity-40"
          title="New document"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {state.isLoading && (
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </div>
        )}
        {state.error && <div className="px-3 py-2 text-xs text-one-red">{state.error}</div>}
        {!state.isLoading && data.documents.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-3 py-6 text-center text-xs text-muted-foreground">
            <Files className="h-5 w-5" />
            No documents yet. Ask the assistant for one, or click +.
          </div>
        )}
        {data.documents.map((doc) => (
          <DocumentRow
            key={doc.id}
            doc={doc}
            active={doc.id === data.openId}
            onOpen={actions.open.document}
            onDelete={actions.submit.delete}
            onRename={actions.submit.rename}
          />
        ))}
      </nav>
      <div className="border-t border-sidebar-border p-3 text-[10px] text-muted-foreground">
        Documents live in this browser.
      </div>
    </aside>
  );
}
