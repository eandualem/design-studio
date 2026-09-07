"use client";

import { useCallback, useState } from "react";
import { AlertCircle, Loader2, Wrench } from "lucide-react";
import { toast } from "sonner";
import type { UserMessageRecord } from "@/types";
import { AssistantState, useAssistantContext } from "@/hooks/useAssistantContext";
import { useAppContext } from "@/hooks/useAppContext";
import { useArtifactsContext } from "@/hooks/useArtifactsContext";
import { StyleGuideView } from "./style-guide-view";
import { AssistantHeader } from "./assistant-header";
import { MessageList } from "./message-list";
import { ChatInput, type Draft } from "./chat-input";
import { MotionProvider } from "./motion-provider";

const EMPTY_DRAFT: Draft = { text: "", branch: null };

export function AssistantPanel() {
  const { state, data, actions } = useAssistantContext();
  const { actions: app } = useAppContext();
  const artifacts = useArtifactsContext();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [view, setView] = useState<"chat" | "styleGuide">("chat");
  const toggleStyleGuide = useCallback(() => {
    if (view === "chat") {
      artifacts.actions.view.open();
      setView("styleGuide");
    } else {
      artifacts.actions.view.close();
      setView("chat");
    }
  }, [view, artifacts.actions.view]);

  const tryVariant = useCallback((message: UserMessageRecord) => {
    setDraft({
      text: message.text,
      branch: {
        parentId: message.parentId,
        label: message.text.length > 60 ? `${message.text.slice(0, 60)}…` : message.text,
      },
    });
  }, []);

  const isStreaming =
    state.assistantState === AssistantState.Streaming ||
    state.assistantState === AssistantState.Cancelling;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <AssistantHeader
        title={data.documentName}
        connection={state.connection}
        totals={data.totals}
        styleGuideOpen={view === "styleGuide"}
        onToggleStyleGuide={toggleStyleGuide}
        onClose={app.toggle.panel}
      />
      {(state.assistantState === AssistantState.NeedsRepair ||
        state.assistantState === AssistantState.Repairing) && (
        <div className="mx-3 mt-2 flex items-center gap-2 rounded-md border border-one-yellow/40 bg-one-yellow/10 px-3 py-2 text-xs text-one-yellow">
          <Wrench className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">
            The runtime is waiting on an action this studio cannot reconstruct. Repair the session to continue.
          </span>
          <button
            onClick={actions.session.repair}
            disabled={state.assistantState === AssistantState.Repairing}
            className="rounded-md bg-one-yellow/20 px-2 py-0.5 hover:opacity-80 disabled:opacity-50"
          >
            {state.assistantState === AssistantState.Repairing ? "Repairing…" : "Repair"}
          </button>
        </div>
      )}
      {view === "styleGuide" && (
        <StyleGuideView
          data={artifacts.data}
          isLoading={artifacts.state.isLoading}
          isBusy={artifacts.state.isBusy}
          error={artifacts.state.error}
          onBack={toggleStyleGuide}
          onRefresh={artifacts.actions.refresh}
          onApprove={artifacts.actions.submit.approve}
          onRollback={artifacts.actions.submit.rollback}
        />
      )}
      {state.error && (
        <div className="mx-3 mt-2 flex items-center gap-2 rounded-md bg-one-red/10 px-3 py-2 text-sm text-one-red">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="truncate">{state.error}</span>
        </div>
      )}
      <MotionProvider>
        {view === "styleGuide" ? null : state.assistantState === AssistantState.Loading ? (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-one-blue" />
            <span className="ml-2 text-sm text-foreground">Loading conversation…</span>
          </div>
        ) : (
          <MessageList
            messages={data.messages}
            variants={data.variants}
            awaitingHostAction={state.assistantState === AssistantState.AwaitingHostAction}
            queuedActions={data.queuedActions}
            canBranch={!state.isBusy}
            onTryVariant={tryVariant}
            onSelectVariant={actions.select.variant}
          />
        )}
        {view === "chat" && (
        <ChatInput
          draft={draft}
          onDraftChange={setDraft}
          onSend={(text, attachments, parentId) => actions.chat.send(text, { attachments, parentId })}
          onSteer={actions.chat.steer}
          onCancel={actions.chat.cancel}
          onAttachError={(message) => toast.error(message)}
          isStreaming={isStreaming}
          isCancelling={state.assistantState === AssistantState.Cancelling}
          disabled={!data.sessionId || state.assistantState === AssistantState.Syncing}
        />
        )}
      </MotionProvider>
    </div>
  );
}
