"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PreviewBlock as PreviewBlockData } from "@/hooks/useDocumentContext";

interface PreviewBlockProps {
  item: PreviewBlockData;
  selected: boolean;
  onSelect: (blockId: string | null) => void;
}

export const PreviewBlock = memo(function PreviewBlock({ item, selected, onSelect }: PreviewBlockProps) {
  const { block, render } = item;
  return (
    <div
      data-block-id={block.id}
      onClick={() => onSelect(selected ? null : block.id)}
      className={cn(
        "-mx-3 cursor-pointer rounded-md border border-transparent px-3 py-1 transition-colors",
        selected ? "border-primary/40 bg-primary/5" : "hover:border-border",
      )}
      title={`Block ${block.id}`}
    >
      {block.kind === "text" ? (
        <div className="prose-studio">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.source}</ReactMarkdown>
        </div>
      ) : render === null ? (
        <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Rendering diagram…
        </div>
      ) : render.ok ? (
        <div
          className="diagram flex justify-center overflow-x-auto py-2"
          dangerouslySetInnerHTML={{ __html: render.svg }}
        />
      ) : (
        <div className="my-2 rounded-md border border-one-red/30 bg-one-red/5 p-3">
          <div className="flex items-center gap-2 text-xs font-medium text-one-red">
            <AlertTriangle className="h-3.5 w-3.5" /> Mermaid could not render this block
          </div>
          <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] text-one-red/90">
            {render.error}
          </pre>
          <pre className="mt-2 whitespace-pre-wrap rounded bg-muted p-2 font-mono text-[11px] text-muted-foreground">
            {block.code}
          </pre>
        </div>
      )}
    </div>
  );
});
