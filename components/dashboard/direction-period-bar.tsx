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
    <div className="flex flex-wrap items-center gap-2">
      {DIRECTION_PERIOD_PRESETS.map((preset) => (
        <Button
          key={preset.key}
          type="button"
          size="sm"
          variant={activeKey === preset.key ? "default" : "outline"}
          onClick={() => {
            setCustomOpen(false);
            goToPreset(preset.key);
          }}
        >
          {preset.label}
        </Button>
      ))}
      <Button
        type="button"
        size="sm"
        variant={activeKey === "custom" ? "default" : "outline"}
        onClick={() => setCustomOpen((open) => !open)}
      >
        Personnalise
      </Button>

      {customOpen ? (
        <div
          className={cn(
            "flex flex-wrap items-end gap-3 rounded-2xl border border-border/70 bg-white/82 px-3 py-2.5",
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
