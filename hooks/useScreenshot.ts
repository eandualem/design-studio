"use client";

import { useCallback, useEffect, useRef } from "react";
import { useSelector } from "@xstate/react";
import { AppMachineContext } from "@/context/appContext";
import { useAppContext } from "./useAppContext";

const PREVIEW_SELECTOR = "[data-preview-pane]";
const CHANGE_DELAY_MS = 800;
const PERIODIC_MS = 20000;

async function captureElement(el: HTMLElement): Promise<string> {
  const html2canvas = (await import("html2canvas")).default;
  const canvas = await html2canvas(el, {
    scale: 1,
    useCORS: true,
    logging: false,
    backgroundColor: getComputedStyle(document.body).backgroundColor,
  });
  return canvas.toDataURL("image/jpeg", 0.7);
}

/**
 * Keeps a recent JPEG of the preview pane in the app machine so every
 * message carries a `screenshot` attachment (read only by look_at_screen).
 * Captured when a document opens, after edits settle, and periodically.
 */
export const useScreenshot = () => {
  const appRef = AppMachineContext.useActorRef();
  const {
    data: { documentRef },
  } = useAppContext();
  const isReady = useSelector(documentRef, (s) => s.matches({ open: "ready" }));
  const documentId = useSelector(documentRef, (s) => s.context.document?.id ?? null);
  const inFlight = useRef(false);

  const capture = useCallback(async () => {
    if (inFlight.current) return;
    const el = document.querySelector<HTMLElement>(PREVIEW_SELECTOR);
    if (!el) {
      appRef.send({ type: "sys.screenshot", dataUri: null });
      return;
    }
    inFlight.current = true;
    try {
      appRef.send({ type: "sys.screenshot", dataUri: await captureElement(el) });
    } catch {
      appRef.send({ type: "sys.screenshot", dataUri: null });
    } finally {
      inFlight.current = false;
    }
  }, [appRef]);

  useEffect(() => {
    if (!documentId) {
      appRef.send({ type: "sys.screenshot", dataUri: null });
      return;
    }
    if (!isReady) return;
    const timer = setTimeout(() => void capture(), CHANGE_DELAY_MS);
    const interval = setInterval(() => void capture(), PERIODIC_MS);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [documentId, isReady, capture, appRef]);

  return { capture };
};
