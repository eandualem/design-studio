import {
  ArtifactMutationSchema,
  ArtifactProfileSchema,
  ArtifactVersionSchema,
  SessionDetailSchema,
  StoredMessagesSchema,
  TreeSchema,
  type ArtifactMutation,
  type ArtifactProfile,
  type ArtifactVersion,
  type SessionDetail,
  type StoredMessage,
  type TreeNode,
} from "@/types";
import { RUNTIME_URL } from "./runtime-url";

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(`${RUNTIME_URL}${path}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`${path}: HTTP ${res.status}`);
  }
  return res.json();
}

async function postJson(path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${RUNTIME_URL}${path}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = String(((await res.json()) as { detail?: unknown }).detail ?? "");
    } catch {
      detail = "";
    }
    throw new Error(`${path}: HTTP ${res.status}${detail ? ` ${detail}` : ""}`);
  }
  return res.json();
}

/** `POST /api/sessions/{id}/repair`: resolve a pending host action the app cannot answer. */
export async function repairSession(sessionId: string): Promise<void> {
  await postJson(`/api/sessions/${encodeURIComponent(sessionId)}/repair`);
}

export async function fetchArtifactProfile(): Promise<ArtifactProfile> {
  return ArtifactProfileSchema.parse(await getJson("/api/artifacts/profile"));
}

export async function fetchArtifact(name: string): Promise<ArtifactVersion> {
  return ArtifactVersionSchema.parse(await getJson(`/api/artifacts/${encodeURIComponent(name)}`));
}

export async function fetchArtifactHistory(name: string): Promise<ArtifactVersion[]> {
  const body = await getJson(`/api/artifacts/${encodeURIComponent(name)}/history`);
  return ArtifactVersionSchema.array().parse(body);
}

export async function approveArtifact(name: string, version: number): Promise<ArtifactMutation> {
  return ArtifactMutationSchema.parse(
    await postJson(`/api/artifacts/${encodeURIComponent(name)}/approve/${version}`),
  );
}

export async function rollbackArtifact(name: string, version: number): Promise<ArtifactMutation> {
  return ArtifactMutationSchema.parse(
    await postJson(`/api/artifacts/${encodeURIComponent(name)}/rollback/${version}`),
  );
}

/**
 * `GET /api/sessions/{id}/messages`: the root-to-leaf path for display;
 * `leaf_id` selects another leaf (a sibling branch) without changing the
 * session's active leaf.
 */
export async function fetchSessionMessages(
  sessionId: string,
  leafId?: string | null,
): Promise<StoredMessage[]> {
  const query = leafId ? `?leaf_id=${encodeURIComponent(leafId)}` : "";
  const body = await getJson(
    `/api/sessions/${encodeURIComponent(sessionId)}/messages${query}`,
  );
  return StoredMessagesSchema.parse(body);
}

/** `GET /api/sessions/{id}/tree`: every message with its parent_id. */
export async function fetchSessionTree(sessionId: string): Promise<TreeNode[]> {
  const body = await getJson(`/api/sessions/${encodeURIComponent(sessionId)}/tree`);
  return TreeSchema.parse(body);
}

/** `GET /api/sessions/{id}`: counts and the pending host action, if any. */
export async function fetchSessionDetail(
  sessionId: string,
): Promise<SessionDetail> {
  const body = await getJson(`/api/sessions/${encodeURIComponent(sessionId)}`);
  return SessionDetailSchema.parse(body);
}

/** A session the runtime has not seen yet answers 404; that is not an error. */
export function isNotFound(error: unknown): boolean {
  return error instanceof Error && /HTTP 404/.test(error.message);
}
