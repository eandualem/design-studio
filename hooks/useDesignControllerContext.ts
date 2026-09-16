"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useSelector } from "@xstate/react";
import { toast } from "sonner";
import { convertStateToString } from "@/lib/stateToStr";
import { normalizeDesignModel } from "@/lib/design-model";
import { useAppContext } from "./useAppContext";

export enum ControllerPhase {
  Idle = "Idle",
  Listening = "Listening",
  Waiting = "Waiting",
  Deciding = "Deciding",
  Executing = "Executing",
}

const phaseMap: Record<string, ControllerPhase> = {
  idle: ControllerPhase.Idle,
  listening: ControllerPhase.Listening,
  waiting: ControllerPhase.Waiting,
  deciding: ControllerPhase.Deciding,
  executing: ControllerPhase.Executing,
  receipting: ControllerPhase.Executing,
  settling: ControllerPhase.Listening,
};

export const useDesignControllerContext = () => {
  const {
    data: { designRef },
  } = useAppContext();

  const stateValue = useSelector(designRef, (s) => s.value);
  const model = useSelector(designRef, (s) => s.context.model);
  const decisions = useSelector(designRef, (s) => s.context.decisions);

  const phase = useMemo(
    () => phaseMap[convertStateToString(stateValue)] ?? ControllerPhase.Idle,
    [stateValue],
  );

  const selectModel = useCallback(
    (value: string): boolean => {
      const normalized = normalizeDesignModel(value);
      if (normalized === null) return false;
      designRef.send({ type: "user.selectModel", model: normalized });
      return true;
    },
    [designRef],
  );
  const stop = useCallback(() => designRef.send({ type: "user.stop" }), [designRef]);

  return {
    state: { phase },
    data: { model, decisions, lastDecision: decisions[decisions.length - 1] ?? null },
    actions: { select: { model: selectModel }, stop },
  };
};

/** Shows the controller's warnings as toasts; mount once (the assistant panel). */
export const useDesignControllerNotifications = () => {
  const {
    data: { designRef },
  } = useAppContext();
  useEffect(() => {
    const subscription = designRef.on("notification", (event) => toast.warning(event.message));
    return () => subscription.unsubscribe();
  }, [designRef]);
};

export type DesignControllerData = ReturnType<typeof useDesignControllerContext>["data"];
export type DesignControllerActions = ReturnType<typeof useDesignControllerContext>["actions"];
