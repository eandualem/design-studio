"use client";

import { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";

const STRING_LIMIT = 200;

interface JsonTreeProps {
  data: unknown;
  defaultExpandDepth?: number;
  currentDepth?: number;
}

export function JsonTree({
  data,
  defaultExpandDepth = 2,
  currentDepth = 0,
}: JsonTreeProps) {
  if (data === null) return <span className="text-muted-foreground">null</span>;
  if (data === undefined)
    return <span className="text-muted-foreground">undefined</span>;

  switch (typeof data) {
    case "string":
      return <StringValue value={data} />;
    case "number":
      return <span className="text-one-orange">{String(data)}</span>;
    case "boolean":
      return <span className="text-one-orange">{String(data)}</span>;
    case "object":
      return (
        <CollapsibleNode
          data={data as Record<string, unknown> | unknown[]}
          kind={Array.isArray(data) ? "array" : "object"}
          defaultExpandDepth={defaultExpandDepth}
          currentDepth={currentDepth}
        />
      );
    default:
      return <span className="text-one-green">{String(data)}</span>;
  }
}

function StringValue({ value }: { value: string }) {
  const [expanded, setExpanded] = useState(false);
  const needsTruncation = value.length > STRING_LIMIT;
  const display =
    !expanded && needsTruncation ? value.slice(0, STRING_LIMIT) : value;

  return (
    <span className="text-one-green" style={{ overflowWrap: "anywhere" }}>
      &quot;{display}
      {needsTruncation && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="ml-1 rounded px-1 text-[10px] text-one-blue hover:bg-accent"
        >
          {expanded ? "show less" : `+${value.length - STRING_LIMIT} more`}
        </button>
      )}
      &quot;
    </span>
  );
}

interface CollapsibleNodeProps {
  data: Record<string, unknown> | unknown[];
  kind: "object" | "array";
  defaultExpandDepth: number;
  currentDepth: number;
}

function CollapsibleNode({
  data,
  kind,
  defaultExpandDepth,
  currentDepth,
}: CollapsibleNodeProps) {
  const [expanded, setExpanded] = useState(currentDepth < defaultExpandDepth);
  const isArray = kind === "array";
  const entries = isArray
    ? (data as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(data as Record<string, unknown>);
  const count = entries.length;
  const open = isArray ? "[" : "{";
  const close = isArray ? "]" : "}";
  const summary = isArray
    ? `${count} item${count !== 1 ? "s" : ""}`
    : `${count} key${count !== 1 ? "s" : ""}`;

  if (count === 0) {
    return (
      <span className="text-foreground">
        {open}
        {close}
      </span>
    );
  }

  return (
    <span>
      <button
        onClick={() => setExpanded(!expanded)}
        className="inline-flex items-center rounded text-foreground hover:bg-accent"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <span>{open}</span>
      </button>
      {!expanded && (
        <>
          <span
            className="mx-0.5 cursor-pointer text-[10px] text-muted-foreground hover:underline"
            onClick={() => setExpanded(true)}
          >
            {summary}
          </span>
          <span className="text-foreground">{close}</span>
        </>
      )}
      {expanded && (
        <>
          <div style={{ paddingLeft: 16 }}>
            {entries.map(([key, value], idx) => (
              <div key={key} className="leading-relaxed">
                {!isArray && (
                  <>
                    <span className="text-one-red">{key}</span>
                    <span className="text-foreground">: </span>
                  </>
                )}
                <JsonTree
                  data={value}
                  defaultExpandDepth={defaultExpandDepth}
                  currentDepth={currentDepth + 1}
                />
                {idx < entries.length - 1 && (
                  <span className="text-foreground">,</span>
                )}
              </div>
            ))}
          </div>
          <span className="text-foreground">{close}</span>
        </>
      )}
    </span>
  );
}
