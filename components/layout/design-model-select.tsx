"use client";

import { useState } from "react";
import { Cpu } from "lucide-react";
import { DESIGN_MODEL_OPTIONS } from "@/lib/design-model";

const OTHER = "__other__";

interface DesignModelSelectProps {
  model: string;
  /** Returns false when the typed id is not a `provider:model`. */
  onSelect: (model: string) => boolean;
}

/**
 * The design model: curated candidates, or "Other…" for any `provider:model`.
 * Only the controller's decisions use it; text chat and the voice do not.
 */
export function DesignModelSelect({ model, onSelect }: DesignModelSelectProps) {
  const curated = DESIGN_MODEL_OPTIONS.some((o) => o.id === model);
  const [other, setOther] = useState<string | null>(curated ? null : model);
  const [invalid, setInvalid] = useState(false);

  const choose = (value: string) => {
    if (value === OTHER) {
      setOther(model && !curated ? model : "");
      return;
    }
    setOther(null);
    setInvalid(false);
    onSelect(value);
  };
  const commit = () => {
    if (other === null) return;
    const ok = onSelect(other);
    setInvalid(!ok);
  };

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground" title="The model that makes design decisions during a live call">
      <Cpu className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">Design model</span>
      <select
        value={other !== null ? OTHER : model}
        onChange={(e) => choose(e.target.value)}
        className="h-7 max-w-[180px] rounded-md border border-border bg-background px-1.5 text-xs text-foreground"
        aria-label="Design model"
      >
        {DESIGN_MODEL_OPTIONS.map((o) => (
          <option key={o.id || "default"} value={o.id} title={o.note}>
            {o.label}
          </option>
        ))}
        <option value={OTHER}>Other…</option>
      </select>
      {other !== null && (
        <input
          value={other}
          onChange={(e) => {
            setOther(e.target.value);
            setInvalid(false);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
          placeholder="provider:model"
          spellCheck={false}
          aria-label="Other design model"
          aria-invalid={invalid}
          className={`h-7 w-44 rounded-md border bg-background px-1.5 font-mono text-xs text-foreground ${
            invalid ? "border-one-red" : "border-border"
          }`}
        />
      )}
    </div>
  );
}
