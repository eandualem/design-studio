"use client";

import { useState } from "react";
import { ArrowLeft, Check, History, Loader2, RefreshCw, RotateCcw, AlertCircle, Sparkles } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ArtifactView } from "@/types";
import type { ArtifactsActions, ArtifactsData } from "@/hooks/useArtifactsContext";
import { cn } from "@/lib/utils";

/** Proposable artifacts first: they are what the owner acts on. */
function rank(item: ArtifactView): number {
  return item.definition.policy.assistant_edit === "propose" ? 0 : 1;
}

const POLICY_LABEL: Record<string, string> = {
  none: "fixed",
  propose: "assistant proposes, you approve",
  autonomous: "assistant edits freely",
};

function ArtifactCard({
  item,
  busy,
  onApprove,
  onRollback,
}: {
  item: ArtifactView;
  busy: boolean;
  onApprove: ArtifactsActions["submit"]["approve"];
  onRollback: ArtifactsActions["submit"]["rollback"];
}) {
  const [showHistory, setShowHistory] = useState(false);
  const proposals = item.history.filter(
    (v) => !v.is_active && v.version !== null && (item.active.version === null || v.version > item.active.version),
  );
  const older = item.history.filter((v) => !v.is_active && !proposals.includes(v));
  const name = item.definition.name.replace(/_/g, " ");

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="flex items-start justify-between gap-2 px-3 py-2">
        <div className="min-w-0">
          <div className="text-sm font-medium capitalize text-accent-foreground">{name}</div>
          <div className="text-[11px] text-muted-foreground">{item.definition.role}</div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider",
            item.definition.policy.assistant_edit === "propose"
              ? "bg-one-magenta/10 text-one-magenta"
              : "bg-accent text-muted-foreground",
          )}
        >
          {POLICY_LABEL[item.definition.policy.assistant_edit]}
        </span>
      </div>

      {proposals.map((p) => (
        <div key={p.id ?? p.version} className="mx-3 mb-2 rounded-md border border-one-magenta/40 bg-one-magenta/5 p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 text-[11px] font-medium text-one-magenta">
              <Sparkles className="h-3 w-3" /> Proposed version {p.version}
              {p.proposed_by && <span className="font-normal text-muted-foreground">by {p.proposed_by}</span>}
            </span>
            <button
              onClick={() => p.version !== null && onApprove(item.definition.name, p.version)}
              disabled={busy}
              className="flex items-center gap-1 rounded-md bg-one-green/15 px-2 py-0.5 text-[11px] text-one-green hover:opacity-80 disabled:opacity-40"
            >
              <Check className="h-3 w-3" /> Approve
            </button>
          </div>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-foreground">{p.content}</pre>
        </div>
      ))}

      <div className="border-t border-border px-3 py-2">
        <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>
            Active{" "}
            {item.active.version !== null ? `version ${item.active.version}` : "default text"}
          </span>
          {older.length > 0 && (
            <button onClick={() => setShowHistory(!showHistory)} className="flex items-center gap-1 hover:text-accent-foreground">
              <History className="h-3 w-3" /> {older.length} older
            </button>
          )}
        </div>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-foreground">
          {item.active.content || "(empty)"}
        </pre>
      </div>

      {showHistory &&
        older.map((v) => (
          <div key={v.id ?? v.version} className="border-t border-border px-3 py-2">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>Version {v.version}</span>
              <button
                onClick={() => v.version !== null && onRollback(item.definition.name, v.version)}
                disabled={busy}
                className="flex items-center gap-1 hover:text-accent-foreground disabled:opacity-40"
              >
                <RotateCcw className="h-3 w-3" /> Restore
              </button>
            </div>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">{v.content}</pre>
          </div>
        ))}
    </div>
  );
}

interface StyleGuideViewProps {
  data: ArtifactsData;
  isLoading: boolean;
  isBusy: boolean;
  error: string | null;
  onBack: () => void;
  onRefresh: () => void;
  onApprove: ArtifactsActions["submit"]["approve"];
  onRollback: ArtifactsActions["submit"]["rollback"];
}

export function StyleGuideView({ data, isLoading, isBusy, error, onBack, onRefresh, onApprove, onRollback }: StyleGuideViewProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-accent-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to chat
        </button>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {data.profile && <span>profile {data.profile}</span>}
          {!data.durable && data.profile && <span title="Versions live in the runtime's memory until it restarts">not durable</span>}
          <button onClick={onRefresh} disabled={isBusy} className="rounded p-1 hover:text-accent-foreground disabled:opacity-40" title="Refresh">
            <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
          </button>
        </div>
      </div>
      {error && (
        <div className="mx-3 mt-2 flex items-center gap-2 rounded-md bg-one-red/10 px-3 py-2 text-xs text-one-red">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{error}</span>
        </div>
      )}
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-3">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            These texts open the assistant&apos;s system prompt. Approving or restoring a version is an
            administrative action on the runtime; the local trusted setup grants it to every caller, so no
            sign-in is needed here.
          </p>
          {isLoading && data.artifacts.length === 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading the assistant artifacts…
            </div>
          )}
          {[...data.artifacts]
            .sort((a, b) => rank(a) - rank(b))
            .map((item) => (
            <ArtifactCard key={item.definition.name} item={item} busy={isBusy} onApprove={onApprove} onRollback={onRollback} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
