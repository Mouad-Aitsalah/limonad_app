import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { PageEyebrow } from "@/components/ui/page-eyebrow";

type MetricCardProps = {
  eyebrow: string;
  title: string;
  value: string;
  helper?: string;
  icon: LucideIcon;
  accent?: "green" | "blue" | "teal" | "orange" | "red" | "navy";
  trend?: {
    value: string;
    direction: "up" | "down" | "neutral";
  };
};

const accentClasses: Record<
  NonNullable<MetricCardProps["accent"]>,
  { bar: string; icon: string }
> = {
  green: { bar: "from-emerald-500 to-emerald-400", icon: "bg-emerald-50 text-emerald-700" },
  blue: { bar: "from-sky-500 to-sky-400", icon: "bg-sky-50 text-sky-700" },
  teal: { bar: "from-teal-500 to-teal-400", icon: "bg-teal-50 text-teal-700" },
  orange: { bar: "from-amber-500 to-amber-400", icon: "bg-amber-50 text-amber-700" },
  red: { bar: "from-rose-500 to-rose-400", icon: "bg-rose-50 text-rose-700" },
  navy: { bar: "from-[#173156] to-[#2b4a7a]", icon: "bg-[#173156]/8 text-[#173156]" },
};

export function MetricCard({
  eyebrow,
  title,
  value,
  helper,
  icon: Icon,
  accent = "green",
  trend,
}: MetricCardProps) {
  const TrendIcon =
    trend?.direction === "up" ? ArrowUpRight : trend?.direction === "down" ? ArrowDownRight : null;

  return (
    <Card className="relative overflow-hidden">
      {/* Flush with the card's true top edge (sibling of CardContent, not
          inside it) so it reads as a crisp accent line, not a floating bar
          inset by the card's own padding. */}
      <div className={cn("absolute inset-x-0 top-0 h-1 bg-gradient-to-r", accentClasses[accent].bar)} />

      <CardContent>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2.5">
            <PageEyebrow>{eyebrow}</PageEyebrow>
            <div>
              <p className="text-sm font-medium text-[var(--text-secondary)]">{title}</p>
              <p className="mt-1.5 font-heading text-[2rem] leading-none font-bold tracking-[-0.03em] text-[var(--text-primary)]">
                {value}
              </p>
            </div>
            {helper ? <p className="text-sm text-[var(--text-secondary)]">{helper}</p> : null}
            {trend ? (
              <div
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold",
                  trend.direction === "up"
                    ? "bg-emerald-50 text-emerald-700"
                    : trend.direction === "down"
                      ? "bg-rose-50 text-rose-700"
                      : "bg-slate-100 text-slate-700",
                )}
              >
                {TrendIcon ? <TrendIcon className="h-3.5 w-3.5" /> : null}
                {trend.value}
              </div>
            ) : null}
          </div>

          <div
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl",
              accentClasses[accent].icon,
            )}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
