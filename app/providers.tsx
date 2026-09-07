"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppMachineContext } from "@/context/appContext";
import { useScreenshot } from "@/hooks/useScreenshot";
import { readPrefs } from "@/lib/prefs";
import { documentRoute, parseDocumentRoute } from "@/lib/routes";

/** Reads stored preferences once the client is up and hands them to the machine. */
function PrefsLoader() {
  const actorRef = AppMachineContext.useActorRef();
  useEffect(() => {
    actorRef.send({ type: "sys.prefsLoaded", ...readPrefs() });
  }, [actorRef]);
  return null;
}

/** Keeps the preview screenshot in the app machine while a document is open. */
function ScreenshotCapture() {
  useScreenshot();
  return null;
}

/** URL ⇄ machine: `/d/<id>` opens a document; the open document's id is mirrored to the URL. */
function RoutingAdapter() {
  const pathname = usePathname();
  const router = useRouter();
  const actorRef = AppMachineContext.useActorRef();
  const openId = AppMachineContext.useSelector((s) => s.context.openId);
  const lastSynced = useRef<string | null>(null);

  useEffect(() => {
    if (pathname === lastSynced.current) return;
    lastSynced.current = pathname;
    const id = parseDocumentRoute(pathname);
    if (id) actorRef.send({ type: "user.openDocument", id });
    else actorRef.send({ type: "user.closeDocument" });
  }, [pathname, actorRef]);

  useEffect(() => {
    const expected = documentRoute(openId);
    if (expected !== lastSynced.current) {
      lastSynced.current = expected;
      router.replace(expected);
    }
  }, [openId, router]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AppMachineContext.Provider>
      <TooltipProvider delayDuration={200}>
        <PrefsLoader />
        <RoutingAdapter />
        <ScreenshotCapture />
        {children}
      </TooltipProvider>
    </AppMachineContext.Provider>
  );
}
