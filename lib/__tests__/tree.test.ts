import { describe, expect, it } from "vitest";
import { addNode, leafOf, siblingsOf, truncateTo, variantsFor } from "@/lib/tree";
import type { MessageRecord, TreeNode } from "@/types";

const t = (id: string, parent_id: string | null, role: string, created_at: string): TreeNode => ({
  id,
  parent_id,
  role,
  created_at,
});

// u1 -> a1 -> u2 -> a2
//               \-> u2b -> a2b
const TREE: TreeNode[] = [
  t("u1", null, "user", "1"),
  t("a1", "u1", "assistant", "2"),
  t("u2", "a1", "user", "3"),
  t("a2", "u2", "assistant", "4"),
  t("u2b", "a1", "user", "5"),
  t("a2b", "u2b", "assistant", "6"),
];

const user = (id: string, parentId: string | null): MessageRecord => ({
  kind: "user",
  id,
  parentId,
  text: id,
  messageType: "standard",
  timestamp: "t",
});
const assistant = (id: string, parentId: string): MessageRecord => ({
  kind: "assistant",
  id,
  parentId,
  segments: [],
  isStreaming: false,
  timestamp: "t",
  model: null,
  usage: null,
  error: null,
});

describe("tree helpers", () => {
  it("finds the newest leaf under a node", () => {
    expect(leafOf(TREE, "u1")).toBe("a2b");
    expect(leafOf(TREE, "u2")).toBe("a2");
    expect(leafOf(TREE, "a2b")).toBe("a2b");
  });

  it("lists sibling user messages oldest first", () => {
    expect(siblingsOf(TREE, "u2b").map((n) => n.id)).toEqual(["u2", "u2b"]);
    expect(siblingsOf(TREE, "u1").map((n) => n.id)).toEqual(["u1"]);
  });

  it("describes variants for the displayed path", () => {
    const path = [user("u1", null), assistant("a1", "u1"), user("u2b", "a1"), assistant("a2b", "u2b")];
    expect(variantsFor(path, TREE)).toEqual({
      u2b: { index: 2, count: 2, leafIds: ["a2", "a2b"] },
    });
  });

  it("adds nodes once and truncates a path for branching", () => {
    expect(addNode(TREE, t("u1", null, "user", "1"))).toHaveLength(6);
    expect(addNode(TREE, t("u3", "a2", "user", "7"))).toHaveLength(7);
    const path = [user("u1", null), assistant("a1", "u1"), user("u2", "a1")];
    expect(truncateTo(path, "a1").map((m) => m.id)).toEqual(["u1", "a1"]);
    expect(truncateTo(path, null)).toEqual([]);
  });
});
