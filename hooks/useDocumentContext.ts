"use client";

import { useCallback, useMemo } from "react";
import { useSelector } from "@xstate/react";
import { MAX_SAVE_RETRIES, type Block, type RenderResult } from "@/types";
import { renderFor } from "@/lib/document-actions";
import { useAppContext } from "./useAppContext";

export interface PreviewBlock {
  block: Block;
  render: RenderResult | null;
}

export const useDocumentContext = () => {
  const {
    data: { documentRef },
  } = useAppContext();
  const document = useSelector(documentRef, (s) => s.context.document);
  const blocks = useSelector(documentRef, (s) => s.context.blocks);
  const renderCache = useSelector(documentRef, (s) => s.context.renderCache);
  const selection = useSelector(documentRef, (s) => s.context.selection);
  const saveError = useSelector(documentRef, (s) => s.context.saveError);
  const retryCount = useSelector(documentRef, (s) => s.context.retryCount);
  const isRetryingSave = useSelector(documentRef, (s) => s.matches({ open: { saveFailed: "retrying" } }));
  const canRetrySave = useSelector(documentRef, (s) => s.matches({ open: { saveFailed: "failed" } }));
  const isOpen = useSelector(documentRef, (s) => s.matches("open"));
  const isSaving = useSelector(
    documentRef,
    (s) => s.matches({ open: "saving" }) || s.matches({ open: "dirty" }),
  );
  const isRendering = useSelector(documentRef, (s) => s.matches({ open: "rendering" }));
  const isExecuting = useSelector(documentRef, (s) => s.context.pending !== null);

  const preview = useMemo<PreviewBlock[]>(
    () => blocks.map((block) => ({ block, render: renderFor(block, renderCache) })),
    [blocks, renderCache],
  );

  const edit = useCallback(
    (content: string) => documentRef.send({ type: "user.edit", content }),
    [documentRef],
  );
  const select = useCallback(
    (blockId: string | null) => documentRef.send({ type: "user.select", blockId }),
    [documentRef],
  );
  const rename = useCallback(
    (name: string) => documentRef.send({ type: "user.rename", name }),
    [documentRef],
  );
  const retrySave = useCallback(() => documentRef.send({ type: "user.retrySave" }), [documentRef]);

  return {
    state: { isOpen, isSaving, isRendering, isExecuting, saveError, isRetryingSave, canRetrySave },
    data: { document, preview, selection, retryCount, maxSaveRetries: MAX_SAVE_RETRIES },
    actions: {
      edit: { content: edit, rename },
      select: { block: select },
      retry: { save: retrySave },
    },
  };
};

export type DocumentData = ReturnType<typeof useDocumentContext>["data"];
export type DocumentActions = ReturnType<typeof useDocumentContext>["actions"];
