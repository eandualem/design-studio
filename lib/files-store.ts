import { createStore, del, entries, get, set } from "idb-keyval";
import { DocumentSchema, type StudioDocument } from "@/types";

const store =
  typeof indexedDB === "undefined"
    ? null
    : createStore("design-studio", "documents");

function requireStore() {
  if (!store) throw new Error("IndexedDB is not available in this environment");
  return store;
}

/** Every document in the browser, newest first. Rows that fail validation are skipped. */
export async function loadDocuments(): Promise<StudioDocument[]> {
  const rows = await entries(requireStore());
  const docs: StudioDocument[] = [];
  for (const [, value] of rows) {
    const parsed = DocumentSchema.safeParse(value);
    if (parsed.success) docs.push(parsed.data);
  }
  return docs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getDocument(id: string): Promise<StudioDocument | null> {
  const value = await get(id, requireStore());
  const parsed = DocumentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function putDocument(doc: StudioDocument): Promise<StudioDocument> {
  await set(doc.id, doc, requireStore());
  return doc;
}

export async function deleteDocument(id: string): Promise<void> {
  await del(id, requireStore());
}

/** A new document with its own runtime session; not stored until putDocument. */
export function newDocument(name: string, content: string): StudioDocument {
  return {
    id: crypto.randomUUID(),
    name: ensureMarkdownName(name),
    content,
    sessionId: crypto.randomUUID(),
    updatedAt: new Date().toISOString(),
  };
}

export function ensureMarkdownName(name: string): string {
  const trimmed = name.trim().replace(/[/\\]/g, "-") || "untitled";
  return trimmed.toLowerCase().endsWith(".md") ? trimmed : `${trimmed}.md`;
}

/** "untitled.md", "untitled-2.md", … avoiding names already in use. */
export function untitledName(existing: { name: string }[]): string {
  const taken = new Set(existing.map((d) => d.name));
  if (!taken.has("untitled.md")) return "untitled.md";
  let n = 2;
  while (taken.has(`untitled-${n}.md`)) n++;
  return `untitled-${n}.md`;
}
