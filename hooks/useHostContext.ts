"use client";

import { useCallback } from "react";
import type { Attachment, HostContext } from "@/types";
import { AppMachineContext } from "@/context/appContext";
import { gatherHostContext } from "@/machines/appMachine";

/**
 * The contributor: turns the current machine snapshots into the host_context
 * that travels with every message and continuation.
 */
export const useHostContext = () => {
  const appRef = AppMachineContext.useActorRef();

  const gather = useCallback(
    (attachments: Attachment[] = []): HostContext =>
      gatherHostContext(appRef.getSnapshot().context, undefined, attachments),
    [appRef],
  );

  return { gather };
};
