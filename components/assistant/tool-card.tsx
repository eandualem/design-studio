"use client";

import { useState } from "react";
import { CheckCircle, Loader2, AlertCircle, Hand, Cpu } from "lucide-react";
import type { ToolCallRecord } from "@/types";
import { cn } from "@/lib/utils";
import { JsonTree } from "./json-tree";

const OUTPUT_LIMIT = 300;

const CATEGORY_STYLE = {
  host: {
    text: "text-primary",
    border: "border-primary/30",
    bg: "bg-primary/5",
    label: "host",
  },
  backend: {
    text: "text-one-blue",
    border: "border-one-blue/30",
    bg: "bg-one-blue/5",
    label: "runtime",
  },
} as const;

function parseOutput(output: unknown): Record<string, unknown> | unknown[] | null {
  if (output == null) return null;
  if (typeof output === "object") return output as Record<string, unknown>;
  if (typeof output !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(output);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function PlainTextOutput({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const needsTruncation = text.length > OUTPUT_LIMIT;
  const display =
    !expanded && needsTruncation ? text.slice(0, OUTPUT_LIMIT) : text;
  return (
    <pre
      className="whitespace-pre-wrap font-mono text-[11px] leading-tight text-foreground"
      style={{ overflowWrap: "anywhere" }}
    >
      {display}
      {needsTruncation && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="ml-1 rounded px-1 text-[10px] text-one-blue hover:bg-accent"
        >
          {expanded ? "show less" : `+${text.length - OUTPUT_LIMIT} more`}
        </button>
      )}
    </pre>
  );
}

export function ToolCard({ tool }: { tool: ToolCallRecord }) {
  const style = CATEGORY_STYLE[tool.category];
  const parsed = tool.output !== undefined ? parseOutput(tool.output) : null;
  const Icon = tool.category === "host" ? Hand : Cpu;

  return (
    <div className={cn("rounded-md border px-3 py-2", style.border, style.bg)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {tool.status === "running" && (
            <Loader2 className={cn("h-3.5 w-3.5 shrink-0 animate-spin", style.text)} />
          )}
          {tool.status === "completed" && (
            <CheckCircle className="h-3.5 w-3.5 shrink-0 text-one-green" />
          )}
          {tool.status === "error" && (
            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-one-red" />
          )}
          <span className={cn("truncate font-mono text-xs font-medium", style.text)}>
            {tool.name}
          </span>
          <span
            className="inline-flex items-center gap-1 rounded-full bg-accent px-1.5 py-px text-[9px] uppercase tracking-wider text-muted-foreground"
            title={tool.category === "host" ? "Performed by this app" : "Performed by the runtime"}
          >
            <Icon className="h-2.5 w-2.5" />
            {style.label}
          </span>
        </div>
        {tool.duration_ms !== undefined && (
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {tool.duration_ms}ms
          </span>
        )}
      </div>
      {Object.keys(tool.input).length > 0 && (
        <div className="mt-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Input
          </span>
          <div className="mt-0.5 overflow-x-auto font-mono text-[11px]">
            <JsonTree data={tool.input} defaultExpandDepth={2} />
          </div>
        </div>
      )}
      {tool.output !== undefined && tool.output !== null && (
        <div className="mt-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Output
          </span>
          <div className="mt-0.5 overflow-x-auto font-mono text-[11px]">
            {parsed ? (
              <JsonTree data={parsed} defaultExpandDepth={1} />
            ) : (
              <PlainTextOutput
                text={
                  typeof tool.output === "string"
                    ? tool.output
                    : JSON.stringify(tool.output, null, 2)
                }
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
