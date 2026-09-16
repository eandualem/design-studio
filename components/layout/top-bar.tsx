"use client";

import { Moon, Sun, PanelRightOpen, PanelRightClose } from "lucide-react";
import type { Theme } from "@/types";
import { DesignModelSelect } from "./design-model-select";

interface TopBarProps {
  title: string | null;
  theme: Theme;
  panelOpen: boolean;
  designModel: string;
  onSelectDesignModel: (model: string) => boolean;
  onToggleTheme: () => void;
  onTogglePanel: () => void;
}

export function TopBar({
  title,
  theme,
  panelOpen,
  designModel,
  onSelectDesignModel,
  onToggleTheme,
  onTogglePanel,
}: TopBarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-6">
      <div className="flex items-center gap-2">
        <h1 className="text-sm font-semibold text-one-yellow">
          {title ?? "No document open"}
        </h1>
      </div>
      <div className="flex items-center gap-3">
        <DesignModelSelect model={designModel} onSelect={onSelectDesignModel} />
        <button
          onClick={onToggleTheme}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          title={theme === "dark" ? "Switch to light" : "Switch to dark"}
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <button
          onClick={onTogglePanel}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          title={panelOpen ? "Hide the assistant" : "Show the assistant"}
        >
          {panelOpen ? (
            <PanelRightClose className="h-4 w-4" />
          ) : (
            <PanelRightOpen className="h-4 w-4" />
          )}
        </button>
      </div>
    </header>
  );
}
