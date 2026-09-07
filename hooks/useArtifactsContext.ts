"use client";

import { useCallback } from "react";
import { useSelector } from "@xstate/react";
import { useAppContext } from "./useAppContext";

export const useArtifactsContext = () => {
  const {
    data: { artifactsRef },
  } = useAppContext();
  const profile = useSelector(artifactsRef, (s) => s.context.profile);
  const durable = useSelector(artifactsRef, (s) => s.context.durable);
  const artifacts = useSelector(artifactsRef, (s) => s.context.artifacts);
  const error = useSelector(artifactsRef, (s) => s.context.error);
  const isLoading = useSelector(artifactsRef, (s) => s.matches("loading"));
  const isBusy = useSelector(artifactsRef, (s) => !s.matches("ready"));

  const open = useCallback(() => artifactsRef.send({ type: "sys.activate" }), [artifactsRef]);
  const close = useCallback(() => artifactsRef.send({ type: "sys.deactivate" }), [artifactsRef]);
  const refresh = useCallback(() => artifactsRef.send({ type: "user.refresh" }), [artifactsRef]);
  const approve = useCallback(
    (name: string, version: number) => artifactsRef.send({ type: "user.approve", name, version }),
    [artifactsRef],
  );
  const rollback = useCallback(
    (name: string, version: number) => artifactsRef.send({ type: "user.rollback", name, version }),
    [artifactsRef],
  );

  return {
    state: { isLoading, isBusy, error },
    data: { profile, durable, artifacts },
    actions: { view: { open, close }, refresh, submit: { approve, rollback } },
  };
};

export type ArtifactsData = ReturnType<typeof useArtifactsContext>["data"];
export type ArtifactsActions = ReturnType<typeof useArtifactsContext>["actions"];
