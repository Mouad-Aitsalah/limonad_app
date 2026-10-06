"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  buildDirectionPeriodQuery,
  DIRECTION_PERIOD_PRESETS,
  type DirectionPeriodKey,
  type DirectionPeriodPresetKey,
} from "@/lib/dashboard-period";

const periodButtonClass = "h-8 rounded-xl px-3.5 text-[0.82rem]";
const periodIdleClass = "text-[var(--text-secondary)] hover:bg-slate-50 hover:text-[var(--text-primary)]";

export function DirectionPeriodBar({ activeKey }: { activeKey: DirectionPeriodKey }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [customOpen, setCustomOpen] = useState(activeKey === "custom");
  const [from, setFrom] = useState(searchParams.get("from") ?? "");
  const [to, setTo] = useState(searchParams.get("to") ?? "");

  function goToPreset(key: DirectionPeriodPresetKey) {
    router.replace(`${pathname}${buildDirectionPeriodQuery({ period: key })}`);
  }

  function applyCustomRange() {
    if (!from || !to) return;
    router.replace(`${pathname}${buildDirectionPeriodQuery({ from, to })}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* One white segmented control: the active period is filled, the others are quiet. */}
      <div
        role="group"
        aria-label="Période"
        className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-2xl border border-slate-200/70 bg-white p-1 shadow-[0_1px_2px_rgb(16_32_56/0.04),0_8px_20px_-14px_rgb(16_32_56/0.14)]"
      >
        {DIRECTION_PERIOD_PRESETS.map((preset) => {
          const active = activeKey === preset.key;
          return (
            <Button
              key={preset.key}
              type="button"
              size="sm"
              variant={active ? "default" : "ghost"}
              aria-pressed={active}
              className={cn(periodButtonClass, active ? "shadow-sm" : periodIdleClass)}
              onClick={() => {
                setCustomOpen(false);
                goToPreset(preset.key);
              }}
            >
              {preset.label}
            </Button>
          );
        })}
        <Button
          type="button"
          size="sm"
          variant={activeKey === "custom" ? "default" : "ghost"}
          aria-pressed={activeKey === "custom"}
          className={cn(periodButtonClass, activeKey === "custom" ? "shadow-sm" : periodIdleClass)}
          onClick={() => setCustomOpen((open) => !open)}
        >
          Personnalisé
        </Button>
      </div>

      {customOpen ? (
        <div
          className={cn(
            "flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200/70 bg-white px-3 py-2.5 shadow-[0_1px_2px_rgb(16_32_56/0.04)]",
          )}
        >
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Du</Label>
            <Input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="h-9 w-[9.5rem]"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Au</Label>
            <Input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="h-9 w-[9.5rem]"
            />
          </div>
          <Button type="button" size="sm" onClick={applyCustomRange} disabled={!from || !to}>
            Appliquer
          </Button>
        </div>
      ) : null}
    </div>
  );
}
