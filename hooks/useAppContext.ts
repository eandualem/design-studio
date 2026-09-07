"use client";

import { useCallback } from "react";
import { AppMachineContext } from "@/context/appContext";

export const useAppContext = () => {
  const actorRef = AppMachineContext.useActorRef();
  const panelOpen = AppMachineContext.useSelector((s) =>
    s.matches({ panel: "open" }),
  );
  const theme = AppMachineContext.useSelector((s) => s.context.theme);
  const filesRef = AppMachineContext.useSelector((s) => s.context.filesRef);
  const documentRef = AppMachineContext.useSelector(
    (s) => s.context.documentRef,
  );
  const assistantRef = AppMachineContext.useSelector(
    (s) => s.context.assistantRef,
  );
  const artifactsRef = AppMachineContext.useSelector(
    (s) => s.context.artifactsRef,
  );

  const togglePanel = useCallback(
    () => actorRef.send({ type: "user.togglePanel" }),
    [actorRef],
  );
  const toggleTheme = useCallback(
    () => actorRef.send({ type: "user.toggleTheme" }),
    [actorRef],
  );

  return {
    state: { panelOpen, theme },
    data: { filesRef, documentRef, assistantRef, artifactsRef },
    actions: {
      toggle: { panel: togglePanel, theme: toggleTheme },
    },
  };
};

export type AppActions = ReturnType<typeof useAppContext>["actions"];
