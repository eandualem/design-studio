import type { DesignFact, HostActionResult, PendingHostAction } from "@/types";

/**
 * What Live is told after the controller's action ran: the action, the block
 * it touched, whether it applied, and the render outcome. Derived from the
 * document machine's result only; never from what the controller intended.
 */
export function factFromResult(action: PendingHostAction, result: HostActionResult): DesignFact {
  const out = (result.result && typeof result.result === "object" ? result.result : {}) as Record<string, unknown>;
  const render = out.render as { ok?: boolean; error?: string } | undefined;
  const block =
    typeof out.block_id === "string"
      ? out.block_id
      : typeof action.arguments.block_id === "string"
        ? action.arguments.block_id
        : null;
  const content = typeof action.arguments.content === "string" ? action.arguments.content : null;
  const summary = content?.split("\n").find((line) => line.trim() && !line.startsWith("```"))?.trim() ?? null;
  return {
    action: action.toolName,
    status: result.outcome === "success" ? "applied" : "failed",
    block,
    summary: summary ? summary.slice(0, 120) : null,
    render:
      result.outcome !== "success"
        ? typeof out.error === "string"
          ? out.error.slice(0, 200)
          : "the action could not be performed"
        : render && render.ok === false
          ? `Mermaid parse error: ${String(render.error ?? "").slice(0, 200)}`
          : null,
  };
}

/** A one-line label for the decision log: the action and its block. */
export function describeAction(action: PendingHostAction): string {
  const block = action.arguments.block_id ?? action.arguments.after_block_id ?? action.arguments.name;
  return typeof block === "string" ? `${action.toolName} ${block}` : action.toolName;
}
