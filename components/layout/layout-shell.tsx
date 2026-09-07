"use client";

import { useSyncExternalStore } from "react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { AppSidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { useAppContext } from "@/hooks/useAppContext";
import { useDocumentContext } from "@/hooks/useDocumentContext";

const emptySubscribe = () => () => {};

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);
  const { state, actions } = useAppContext();
  const { data: doc } = useDocumentContext();

  return (
    <div className="fixed inset-0 flex overflow-hidden">
      <AppSidebar />
      <ResizablePanelGroup id="main-layout" direction="horizontal" className="flex-1">
        <ResizablePanel
          id="main-content"
          order={1}
          defaultSize={mounted && state.panelOpen ? 65 : 100}
          minSize={40}
        >
          <div className="flex h-full flex-col overflow-hidden">
            <TopBar
              title={doc.document?.name ?? null}
              theme={state.theme}
              panelOpen={state.panelOpen}
              onToggleTheme={actions.toggle.theme}
              onTogglePanel={actions.toggle.panel}
            />
            <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
              {children}
            </main>
          </div>
        </ResizablePanel>
        {mounted && state.panelOpen && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel id="assistant-panel" order={2} defaultSize={35} minSize={25} maxSize={55}>
              <AssistantPanel />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}
