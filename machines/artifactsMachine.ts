import { assign, fromPromise, setup } from "xstate";
import type { ArtifactView } from "@/types";
import {
  approveArtifact,
  fetchArtifact,
  fetchArtifactHistory,
  fetchArtifactProfile,
  rollbackArtifact,
} from "@/lib/runtime-api";
import { actorError } from "@/lib/xstate-utils";

type Events =
  | { type: "sys.activate" }
  | { type: "sys.deactivate" }
  | { type: "user.refresh" }
  | { type: "user.approve"; name: string; version: number }
  | { type: "user.rollback"; name: string; version: number };

async function loadArtifacts(): Promise<{ profile: string; durable: boolean; artifacts: ArtifactView[] }> {
  const profile = await fetchArtifactProfile();
  const artifacts = await Promise.all(
    profile.artifacts.map(async (definition) => {
      const [active, history] = await Promise.all([
        fetchArtifact(definition.name),
        fetchArtifactHistory(definition.name),
      ]);
      return { definition, active, history };
    }),
  );
  return { profile: profile.name, durable: profile.durable, artifacts };
}

export const artifactsMachine = setup({
  types: {
    context: {} as {
      profile: string | null;
      durable: boolean;
      artifacts: ArtifactView[];
      error: string | null;
    },
    events: {} as Events,
  },
  actors: {
    loader: fromPromise(async () => loadArtifacts()),
    approver: fromPromise(async ({ input }: { input: { name: string; version: number } }) =>
      approveArtifact(input.name, input.version),
    ),
    rollbacker: fromPromise(async ({ input }: { input: { name: string; version: number } }) =>
      rollbackArtifact(input.name, input.version),
    ),
  },
  actions: {
    setError: assign({ error: ({ event }) => String(actorError(event)) }),
  },
}).createMachine({
  id: "artifacts",
  description: [
    "Context:",
    "",
    "- profile (string | null): the active profile name from GET /api/artifacts/profile.",
    "- durable (boolean): whether versions survive a runtime restart (Postgres present).",
    "- artifacts (ArtifactView[]): every artifact of the profile with its active version and history, in prompt order.",
    "- error (string | null): why the last load or mutation failed.",
  ].join("\n"),
  context: { profile: null, durable: false, artifacts: [], error: null },
  initial: "inactive",
  states: {
    inactive: {
      description: "The style guide view is closed; nothing is fetched.",
      on: {
        "sys.activate": { description: "The view opened.", target: "loading" },
      },
    },
    loading: {
      description: "Reading the profile, every active version and every history. Invokes loader.",
      invoke: {
        src: "loader",
        onDone: {
          description: "Loaded.",
          target: "ready",
          actions: assign({
            profile: ({ event }) => event.output.profile,
            durable: ({ event }) => event.output.durable,
            artifacts: ({ event }) => event.output.artifacts,
            error: null,
          }),
        },
        onError: { description: "The runtime could not be read.", target: "ready", actions: "setError" },
      },
      on: {
        "sys.deactivate": { description: "The view closed while loading.", target: "inactive" },
      },
    },
    ready: {
      description: "Artifacts are shown; proposals can be approved and older versions restored.",
      on: {
        "user.refresh": { description: "Re-read everything.", target: "loading" },
        "user.approve": { description: "Activate a proposed version.", target: "approving" },
        "user.rollback": { description: "Reactivate an older version.", target: "rollingBack" },
        "sys.deactivate": { description: "The view closed; data is kept for next time.", target: "inactive" },
      },
    },
    approving: {
      description: "POST /api/artifacts/{name}/approve/{version}. Invokes approver.",
      invoke: {
        src: "approver",
        input: ({ event }) =>
          event.type === "user.approve" ? { name: event.name, version: event.version } : { name: "", version: 0 },
        onDone: { description: "Approved; reload to show the new active version.", target: "loading" },
        onError: { description: "The approval was refused.", target: "ready", actions: "setError" },
      },
    },
    rollingBack: {
      description: "POST /api/artifacts/{name}/rollback/{version}. Invokes rollbacker.",
      invoke: {
        src: "rollbacker",
        input: ({ event }) =>
          event.type === "user.rollback" ? { name: event.name, version: event.version } : { name: "", version: 0 },
        onDone: { description: "Rolled back; reload.", target: "loading" },
        onError: { description: "The rollback was refused.", target: "ready", actions: "setError" },
      },
    },
  },
});
