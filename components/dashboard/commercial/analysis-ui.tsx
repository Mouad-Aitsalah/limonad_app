"use client";

import { Info } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** The explanation of a figure: native tooltip on hover + readable by assistive tech and on touch (always in the DOM). */
export function InfoHint({ text, label }: { text: string; label: string }) {
  return (
    <span
      role="note"
      tabIndex={0}
      title={text}
      aria-label={`${label} : ${text}`}
      className="inline-flex size-4 shrink-0 cursor-help items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <Info aria-hidden="true" className="size-3.5" />
    </span>
  );
}

/** KPI card in the look of the Direction dashboard (white card, soft shadow, pastel top line). */
export function AnalysisKpiCard({
  id,
  label,
  value,
  hint,
  caption,
  emphasis = false,
  accent = "bg-emerald-300",
}: {
  id: string;
  label: string;
  value: string;
  hint?: string;
  caption?: string;
  emphasis?: boolean;
  accent?: string;
}) {
  return (
    <Card
      data-kpi={id}
      className={cn(
        "relative h-full gap-0 rounded-[22px] border-slate-200/60 bg-white py-0 shadow-[0_1px_2px_rgb(16_32_56/0.04),0_10px_26px_-16px_rgb(16_32_56/0.16)]",
        emphasis && "ring-1 ring-emerald-200",
      )}
    >
      <span aria-hidden="true" className={cn("absolute inset-x-0 top-0 h-[3px] rounded-t-[22px]", accent)} />
      <CardContent className="flex h-full flex-col gap-2 px-5 pt-6 pb-5">
        <div className="flex items-center gap-1.5">
          <p className="text-[0.82rem] leading-snug font-medium text-[var(--text-secondary)]">{label}</p>
          {hint ? <InfoHint text={hint} label={label} /> : null}
        </div>
        <p className="font-heading text-[1.7rem] leading-[1.1] font-bold tracking-[-0.03em] text-[var(--text-primary)] tabular-nums">
          {value}
        </p>
        {caption ? <p className="mt-auto text-[0.72rem] text-muted-foreground">{caption}</p> : null}
      </CardContent>
    </Card>
  );
}

export function AnalysisState({
  loading,
  error,
  onRetry,
}: {
  loading: boolean;
  error?: string;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        <span>{error}</span>
        <button type="button" onClick={onRetry} className="rounded-lg border border-red-300 bg-white px-3 py-1 text-xs font-semibold hover:bg-red-100">
          Réessayer
        </button>
      </div>
    );
  }
  if (loading) {
    return (
      <p role="status" className="text-xs text-muted-foreground">
        Chargement des données…
      </p>
    );
  }
  return null;
}

export function EmptyAnalysis({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/** A labelled native-looking filter field: label above, the control below. */
export function FilterField({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/** A drop-down over a list of { value, label } options (the app's Select, one place for the three filters). */
export function OptionSelect({
  id,
  value,
  options,
  onChange,
  ariaLabel,
}: {
  id?: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  return (
    <Select value={value} onValueChange={(next) => next && onChange(next)}>
      <SelectTrigger id={id} aria-label={ariaLabel} className="w-full">
        <SelectValue>{(current: string | null) => options.find((option) => option.value === current)?.label ?? "Sélectionner"}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
