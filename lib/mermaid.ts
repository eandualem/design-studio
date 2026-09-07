import type { RenderResult } from "@/types";

let initialised: Promise<typeof import("mermaid").default> | null = null;

async function loadMermaid() {
  if (!initialised) {
    initialised = import("mermaid").then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "neutral",
        fontFamily: "var(--font-inter), sans-serif",
      });
      return mermaid;
    });
  }
  return initialised;
}

let counter = 0;

/**
 * Render one Mermaid diagram to SVG in the browser. A parse error becomes
 * `{ ok: false, error }` with Mermaid's message, which the host reports back
 * to the assistant so it can repair the block.
 */
export async function renderDiagram(code: string): Promise<RenderResult> {
  try {
    const mermaid = await loadMermaid();
    await mermaid.parse(code);
    const id = `studio-diagram-${Date.now()}-${counter++}`;
    const { svg } = await mermaid.render(id, code);
    return { ok: true, svg };
  } catch (error) {
    return { ok: false, error: describeError(error) };
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/\s+/g, " ").trim();
  }
  return String(error);
}
