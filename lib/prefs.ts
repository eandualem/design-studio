import type { Theme } from "@/types";

const THEME_KEY = "design-studio:theme";
const PANEL_KEY = "design-studio:panel-open";
const LOBBY_KEY = "design-studio:lobby-session";

export interface Prefs {
  theme: Theme;
  panelOpen: boolean;
  /** The runtime session used while no document is open. */
  lobbySessionId: string;
}

export function readPrefs(): Prefs {
  const fallback: Prefs = {
    theme: "dark",
    panelOpen: true,
    lobbySessionId: crypto.randomUUID(),
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

export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

/** Inline, pre-hydration script that applies the stored theme before paint. */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_KEY,
)});document.documentElement.classList.toggle("dark",t!=="light");}catch(e){document.documentElement.classList.add("dark");}})();`;
