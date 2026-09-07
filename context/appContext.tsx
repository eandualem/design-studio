"use client";

import { createActorContext } from "@xstate/react";
import { appMachine } from "@/machines/appMachine";

export const AppMachineContext = createActorContext(appMachine);
