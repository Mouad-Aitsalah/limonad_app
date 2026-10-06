import {
  Banknote,
  BarChart3,
  HandCoins,
  Package,
  Receipt,
  ShoppingBag,
  ShoppingBasket,
  ShoppingCart,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * The look of each Direction KPI card: a soft accent colour (the thin line on top
 * of the card and the tinted circle behind the icon) and a discreet icon, chosen
 * from the KPI's own id so the page, the server data and the DTO stay untouched.
 * Pastel on purpose: elegant, never flashy.
 *
 * Every class is written out in full (Tailwind only generates classes it can read
 * in the source), never assembled from a colour name.
 */
export type KpiTone = "green" | "blue" | "teal" | "orange" | "violet" | "cyan" | "red" | "slate";

// line: 3 px, softened (/70) so it reads as an accent, never as a coloured band.
// circle: the -50 tint with a -100 hairline; icon: the -500/-600 shade of the same hue.
export const KPI_TONES: Record<KpiTone, { line: string; circle: string; icon: string }> = {
  green: { line: "bg-emerald-400/70", circle: "bg-emerald-50 ring-emerald-100", icon: "text-emerald-600" },
  blue: { line: "bg-blue-400/70", circle: "bg-blue-50 ring-blue-100", icon: "text-blue-600" },
  teal: { line: "bg-teal-400/70", circle: "bg-teal-50 ring-teal-100", icon: "text-teal-600" },
  orange: { line: "bg-orange-400/70", circle: "bg-orange-50 ring-orange-100", icon: "text-orange-500" },
  violet: { line: "bg-violet-400/70", circle: "bg-violet-50 ring-violet-100", icon: "text-violet-600" },
  cyan: { line: "bg-cyan-400/70", circle: "bg-cyan-50 ring-cyan-100", icon: "text-cyan-600" },
  red: { line: "bg-rose-400/70", circle: "bg-rose-50 ring-rose-100", icon: "text-rose-500" },
  slate: { line: "bg-slate-300/70", circle: "bg-slate-50 ring-slate-100", icon: "text-slate-500" },
};

export type KpiVisual = { tone: KpiTone; icon: LucideIcon };

export const KPI_VISUALS: Record<string, KpiVisual> = {
  revenue: { tone: "green", icon: Banknote },
  "gross-margin": { tone: "blue", icon: TrendingUp },
  "estimated-result": { tone: "teal", icon: Target },
  "customer-receivables": { tone: "orange", icon: HandCoins },
  "stock-value": { tone: "violet", icon: Package },
  "sales-count": { tone: "blue", icon: ShoppingCart },
  "avg-basket": { tone: "violet", icon: ShoppingBasket },
  "purchases-ht": { tone: "cyan", icon: ShoppingBag },
  "charges-ht": { tone: "red", icon: Receipt },
  "active-customers": { tone: "green", icon: Users },
  // the two indicators of the "Intelligence & Prévisions IA" section
  "forecast-units": { tone: "violet", icon: Sparkles },
  "forecast-revenue": { tone: "green", icon: Banknote },
};

const DEFAULT_VISUAL: KpiVisual = { tone: "slate", icon: BarChart3 };

export function kpiVisual(id: string): KpiVisual {
  return KPI_VISUALS[id] ?? DEFAULT_VISUAL;
}
