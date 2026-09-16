import type { Theme } from "@/types";
import { normalizeDesignModel } from "./design-model";

const THEME_KEY = "design-studio:theme";
const PANEL_KEY = "design-studio:panel-open";
const LOBBY_KEY = "design-studio:lobby-session";
const DESIGN_MODEL_KEY = "design-studio:design-model";

export interface Prefs {
  theme: Theme;
  panelOpen: boolean;
  /** The runtime session used while no document is open. */
  lobbySessionId: string;
  /** The design model for live-call decisions: `provider:model`, or empty for the runtime default. */
  designModel: string;
}

export function readPrefs(): Prefs {
  const fallback: Prefs = {
    theme: "dark",
    panelOpen: true,
    lobbySessionId: crypto.randomUUID(),
    designModel: "",
  };
  if (typeof window === "undefined") return fallback;
  try {
    const theme = window.localStorage.getItem(THEME_KEY);
    const panel = window.localStorage.getItem(PANEL_KEY);
    let lobby = window.localStorage.getItem(LOBBY_KEY);
    if (!lobby) {
      lobby = fallback.lobbySessionId;
      window.localStorage.setItem(LOBBY_KEY, lobby);
    }
    return {
      theme: theme === "light" ? "light" : "dark",
      panelOpen: panel === null ? true : panel === "true",
      lobbySessionId: lobby,
      designModel: normalizeDesignModel(window.localStorage.getItem(DESIGN_MODEL_KEY)) ?? "",
    };
  } catch {
    return fallback;
  }
}

export function writeLobbySession(id: string): void {
  write(LOBBY_KEY, id);
}

function write(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: preferences are session-only */
  }
}

export function writeThemePref(theme: Theme): void {
  write(THEME_KEY, theme);
}

export function writePanelPref(panelOpen: boolean): void {
  write(PANEL_KEY, String(panelOpen));
}

export function writeDesignModelPref(model: string): void {
  if (typeof window === "undefined") return;
  try {
    if (model) window.localStorage.setItem(DESIGN_MODEL_KEY, model);
    else window.localStorage.removeItem(DESIGN_MODEL_KEY);
  } catch {
    /* storage unavailable: the choice lasts for this page */
  }
}

export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

/** Inline, pre-hydration script that applies the stored theme before paint. */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_KEY,
)});document.documentElement.classList.toggle("dark",t!=="light");}catch(e){document.documentElement.classList.add("dark");}})();`;
