"use client";

import { useState } from "react";
import { ChevronDown, Wrench } from "lucide-react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { AnimatePresence, m } from "motion/react";
import type { ToolGroup } from "@/types";
import { ToolCard } from "./tool-card";

interface ToolExecutionGroupProps {
  group: ToolGroup;
  isStreaming: boolean;
}

export function ToolExecutionGroup({ group, isStreaming }: ToolExecutionGroupProps) {
  const [open, setOpen] = useState(isStreaming);
  const completed = group.tools.filter((t) => t.status === "completed").length;
  const total = group.tools.length;

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <div className="my-2">
        <Collapsible.Trigger asChild>
          <button className="flex items-center gap-1.5 text-xs text-muted-foreground transition-opacity hover:opacity-80">
            <m.span
              className="inline-flex"
              animate={{ rotate: open ? 0 : -90 }}
              transition={{ duration: 0.15 }}
            >
              <ChevronDown className="h-3 w-3" />
            </m.span>
            <Wrench className="h-3 w-3" />
            <span className="font-medium">
              {completed}/{total} tool{total !== 1 ? "s" : ""}
            </span>
          </button>
        </Collapsible.Trigger>
        <AnimatePresence initial={false}>
          {open && (
            <m.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              style={{ overflow: "hidden" }}
            >
              <div className="mt-1.5 flex flex-col gap-1.5 pl-4">
                {group.tools.map((tool, i) => (
                  <ToolCard key={`${tool.id}-${i}`} tool={tool} />
                ))}
              </div>
            </m.div>
          )}
        </AnimatePresence>
      </div>
    </Collapsible.Root>
  );
}
