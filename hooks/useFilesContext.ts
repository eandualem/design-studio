"use client";

import { useCallback } from "react";
import { useSelector } from "@xstate/react";
import { AppMachineContext } from "@/context/appContext";
import { useAppContext } from "./useAppContext";

export const useFilesContext = () => {
  const appRef = AppMachineContext.useActorRef();
  const {
    data: { filesRef },
  } = useAppContext();
  const documents = useSelector(filesRef, (s) => s.context.documents);
  const error = useSelector(filesRef, (s) => s.context.error);
  const isLoading = useSelector(filesRef, (s) => s.matches("loading"));
  const isBusy = useSelector(filesRef, (s) => !s.matches("ready"));
  const openId = AppMachineContext.useSelector((s) => s.context.openId);

  const open = useCallback(
    (id: string) => appRef.send({ type: "user.openDocument", id }),
    [appRef],
  );
  const close = useCallback(() => appRef.send({ type: "user.closeDocument" }), [appRef]);
  const create = useCallback(() => filesRef.send({ type: "user.create" }), [filesRef]);
  const remove = useCallback(
    (id: string) => filesRef.send({ type: "user.delete", id }),
    [filesRef],
  );
  const rename = useCallback(
    (id: string, name: string) => filesRef.send({ type: "user.rename", id, name }),
    [filesRef],
  );

  return {
    state: { isLoading, isBusy, error },
    data: { documents, openId },
    actions: {
      open: { document: open, list: close },
      submit: { create, rename, delete: remove },
    },
  };
};

export type FilesData = ReturnType<typeof useFilesContext>["data"];
export type FilesActions = ReturnType<typeof useFilesContext>["actions"];
