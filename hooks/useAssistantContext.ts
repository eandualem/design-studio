"use client";

import { useCallback, useMemo } from "react";
import { useSelector } from "@xstate/react";
import type { AttachmentPreview } from "@/types";
import { convertStateToString } from "@/lib/stateToStr";
import { toReferenceAttachments } from "@/lib/attachments";
import { variantsFor } from "@/lib/tree";
import { useAppContext } from "./useAppContext";
import { useHostContext } from "./useHostContext";

export interface SendOptions {
  attachments?: AttachmentPreview[];
  /** Branch from this message id (null = a new root); undefined = continue the path. */
  parentId?: string | null;
}

export enum AssistantState {
  Idle = "Idle",
  Loading = "Loading",
  Syncing = "Syncing",
  NeedsRepair = "NeedsRepair",
  Repairing = "Repairing",
  Streaming = "Streaming",
  Cancelling = "Cancelling",
  AwaitingHostAction = "AwaitingHostAction",
}

const stateMap: Record<string, AssistantState> = {
  idle: AssistantState.Idle,
  syncingTree: AssistantState.Syncing,
  needsRepair: AssistantState.NeedsRepair,
  repairing: AssistantState.Repairing,
  loadingHistory: AssistantState.Loading,
  "streaming.live": AssistantState.Streaming,
  "streaming.cancelling": AssistantState.Cancelling,
  awaitingHostAction: AssistantState.AwaitingHostAction,
};

export const useAssistantContext = () => {
  const {
    data: { assistantRef, documentRef },
  } = useAppContext();
  const { gather } = useHostContext();

  const stateValue = useSelector(assistantRef, (s) => s.value);
  const messages = useSelector(assistantRef, (s) => s.context.messages);
  const tree = useSelector(assistantRef, (s) => s.context.tree);
  const pendingAction = useSelector(
    assistantRef,
    (s) => s.context.pendingAction,
  );
  const connection = useSelector(assistantRef, (s) => s.context.connection);
  const error = useSelector(assistantRef, (s) => s.context.error);
  const totals = useSelector(assistantRef, (s) => s.context.totals);
  const sessionId = useSelector(assistantRef, (s) => s.context.sessionId);
  const documentName = useSelector(
    documentRef,
    (s) => s.context.document?.name ?? null,
  );

  const assistantState = useMemo(
    () => stateMap[convertStateToString(stateValue)] ?? AssistantState.Idle,
    [stateValue],
  );

  const variants = useMemo(() => variantsFor(messages, tree), [messages, tree]);

  const send = useCallback(
    (text: string, options: SendOptions = {}) => {
      const previews = options.attachments ?? [];
      const attachments = toReferenceAttachments(previews);
      assistantRef.send({
        type: "user.send",
        text,
        hostContext: gather(attachments),
        attachments,
        previews,
        parentId: options.parentId,
      });
    },
    [assistantRef, gather],
  );
  const steer = useCallback(
    (text: string) => assistantRef.send({ type: "user.steer", text }),
    [assistantRef],
  );
  const selectVariant = useCallback(
    (leafId: string) => assistantRef.send({ type: "user.selectVariant", leafId }),
    [assistantRef],
  );
  const cancel = useCallback(
    () => assistantRef.send({ type: "user.cancel" }),
    [assistantRef],
  );
  const repair = useCallback(
    () => assistantRef.send({ type: "user.repair" }),
    [assistantRef],
  );

  return {
    state: {
      assistantState,
      isBusy:
        assistantState === AssistantState.Syncing ||
        assistantState === AssistantState.NeedsRepair ||
        assistantState === AssistantState.Repairing ||
        assistantState === AssistantState.Streaming ||
        assistantState === AssistantState.Cancelling ||
        assistantState === AssistantState.AwaitingHostAction,
      connection,
      error,
    },
    data: {
      messages,
      variants,
      pendingAction,
      queuedActions: pendingAction?.queued.length ?? 0,
      totals,
      sessionId,
      documentName,
    },
    actions: { chat: { send, steer, cancel }, select: { variant: selectVariant }, session: { repair } },
  };
};

export type AssistantData = ReturnType<typeof useAssistantContext>["data"];
export type AssistantActions = ReturnType<
  typeof useAssistantContext
>["actions"];
