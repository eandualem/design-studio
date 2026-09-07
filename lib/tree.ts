import type { MessageRecord, TreeNode, VariantInfo } from "@/types";

function byCreated(a: TreeNode, b: TreeNode): number {
  return (a.created_at ?? "").localeCompare(b.created_at ?? "");
}

/** The newest leaf reachable from a node (the node itself when it has no children). */
export function leafOf(tree: TreeNode[], nodeId: string): string {
  let current = nodeId;
  for (;;) {
    const children = tree.filter((n) => n.parent_id === current).sort(byCreated);
    if (children.length === 0) return current;
    current = children[children.length - 1].id;
  }
}

/** Sibling user messages of a node, oldest first (the node included). */
export function siblingsOf(tree: TreeNode[], nodeId: string): TreeNode[] {
  const node = tree.find((n) => n.id === nodeId);
  if (!node) return [];
  return tree
    .filter((n) => n.parent_id === node.parent_id && n.role === node.role)
    .sort(byCreated);
}

/**
 * For every user message on the displayed path that has siblings, which
 * variant is shown and which leaf to load for each alternative.
 */
export function variantsFor(messages: MessageRecord[], tree: TreeNode[]): Record<string, VariantInfo> {
  const result: Record<string, VariantInfo> = {};
  for (const m of messages) {
    if (m.kind !== "user" || m.messageType === "steering") continue;
    const siblings = siblingsOf(tree, m.id);
    if (siblings.length < 2) continue;
    result[m.id] = {
      index: siblings.findIndex((s) => s.id === m.id) + 1,
      count: siblings.length,
      leafIds: siblings.map((s) => leafOf(tree, s.id)),
    };
  }
  return result;
}

/** Add a node the app just created, so the tree is current without a refetch. */
export function addNode(tree: TreeNode[], node: TreeNode): TreeNode[] {
  return tree.some((n) => n.id === node.id) ? tree : [...tree, node];
}

/** The displayed path cut back to a message, for branching from it. */
export function truncateTo(messages: MessageRecord[], parentId: string | null): MessageRecord[] {
  if (parentId === null) return [];
  const i = messages.findIndex((m) => m.id === parentId);
  return i < 0 ? messages : messages.slice(0, i + 1);
}
