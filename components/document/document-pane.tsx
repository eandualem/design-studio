"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Save, AlertCircle, Hand } from "lucide-react";
import { useDocumentContext } from "@/hooks/useDocumentContext";
import { useFilesContext } from "@/hooks/useFilesContext";
import { PreviewBlock } from "./preview-block";

function FilesView() {
  const { state, data, actions } = useFilesContext();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm text-muted-foreground">
        {state.isLoading
          ? "Loading documents…"
          : data.documents.length === 0
            ? "No documents yet."
            : "Pick a document on the left, or start a new one."}
      </p>
      <button
        onClick={actions.submit.create}
        disabled={state.isBusy}
        className="rounded-md bg-primary/15 px-3 py-1.5 text-sm text-primary hover:opacity-80 disabled:opacity-40"
      >
        New document
      </button>
      <p className="max-w-sm text-xs text-muted-foreground/70">
        Or ask the assistant: it can create a document and draw the first diagram.
      </p>
    </div>
  );
}

export function DocumentPane() {
  const { state, data, actions } = useDocumentContext();
  const [tab, setTab] = useState("preview");

  if (!state.isOpen || !data.document) return <FilesView />;

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-border px-6 py-2">
        <TabsList className="h-8">
          <TabsTrigger value="source" className="text-xs">Source</TabsTrigger>
          <TabsTrigger value="preview" className="text-xs">Preview</TabsTrigger>
        </TabsList>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          {state.isExecuting && (
            <span className="flex items-center gap-1 text-primary">
              <Hand className="h-3 w-3" /> assistant editing
            </span>
          )}
          {state.isSaving ? (
            <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> saving</span>
          ) : state.isRendering ? (
            <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> rendering</span>
          ) : state.saveError ? (
            <span className="flex items-center gap-1 text-one-red" title={state.saveError}><AlertCircle className="h-3 w-3" /> not saved</span>
          ) : (
            <span className="flex items-center gap-1"><Save className="h-3 w-3" /> saved</span>
          )}
        </div>
      </div>
      <TabsContent value="source" className="mt-0 min-h-0 flex-1">
        <textarea
          value={data.document.content}
          onChange={(e) => actions.edit.content(e.target.value)}
          spellCheck={false}
          className="h-full w-full resize-none bg-background p-6 font-mono text-[13px] leading-relaxed text-foreground outline-none"
          placeholder="# Title&#10;&#10;```mermaid&#10;flowchart LR&#10;  A --> B&#10;```"
        />
      </TabsContent>
      <TabsContent value="preview" className="mt-0 min-h-0 flex-1">
        <ScrollArea className="h-full">
          <div data-preview-pane className="mx-auto max-w-3xl px-8 py-6">
            {data.preview.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Empty document. Type in Source or ask the assistant.
              </p>
            )}
            {data.preview.map((item) => (
              <PreviewBlock
                key={item.block.id}
                item={item}
                selected={data.selection === item.block.id}
                onSelect={actions.select.block}
              />
            ))}
          </div>
        </ScrollArea>
      </TabsContent>
    </Tabs>
  );
}
