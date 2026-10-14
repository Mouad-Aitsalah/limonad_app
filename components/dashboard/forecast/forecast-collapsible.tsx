"use client";

import * as React from "react";
import { ChevronDown, Sparkles } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * « Intelligence & Prévisions IA » as a compact bar, CLOSED by default: one click opens the whole section,
 * a second one folds it back. The content is rendered once and only hidden while closed (it stays mounted:
 * opening it again never reloads anything, and the forecast keeps streaming in the background).
 */
export function ForecastCollapsible({
  title,
  description,
  defaultOpen = false,
  children,
}: {
  title: string;
  description: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const contentId = React.useId();

  return (
    <Card
      data-forecast-collapsible={open ? "open" : "closed"}
      className="relative gap-0 overflow-hidden rounded-[22px] border-slate-200/70 bg-white py-0 shadow-[0_1px_2px_rgb(16_32_56/0.04),0_12px_28px_-14px_rgb(16_32_56/0.14)]"
    >
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-violet-400/80 via-blue-400/70 to-emerald-400/80" />
      <h2 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen((value) => !value)}
          className="flex w-full items-center gap-3 px-4 pt-4 pb-3.5 text-left transition-colors outline-none hover:bg-slate-50/70 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset sm:gap-3.5 sm:px-6"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-violet-50 ring-1 ring-violet-100">
            <Sparkles aria-hidden="true" className="size-4.5 text-violet-600" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-heading text-base leading-snug font-semibold tracking-[-0.02em] text-foreground">{title}</span>
            <span className={cn("block text-xs leading-5 text-muted-foreground sm:text-sm", !open && "max-sm:truncate")}>{description}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <span className="max-sm:sr-only">{open ? "Masquer" : "Afficher"}</span>
            <ChevronDown aria-hidden="true" className={cn("size-5 transition-transform duration-200", open && "rotate-180")} />
          </span>
        </button>
      </h2>
      <div id={contentId} role="region" aria-label={title} hidden={!open} className="px-4 pt-1 pb-5 sm:px-6">
        {children}
      </div>
    </Card>
  );
}
