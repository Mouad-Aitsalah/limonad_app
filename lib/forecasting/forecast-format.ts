import { BUSINESS_DAY_TIME_ZONE } from "@/lib/business-day";
import type { ForecastQuality, ForecastReliability } from "@/types/dashboard-forecast";

/** "2026-10-06" -> "lun. 06/10" (the business day itself, no timezone shift). */
export function formatForecastDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;
  const weekday = new Intl.DateTimeFormat("fr-FR", { weekday: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
  return `${weekday} ${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`;
}

/** ISO instant -> "03/10/2026 à 01:10" in the business timezone. */
export function formatComputedAt(iso: string): string {
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: BUSINESS_DAY_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} à ${get("hour")}:${get("minute")}`;
}

/** "2026-10-03" -> "03/10/2026" */
export function formatBusinessDay(day: string): string {
  const [year, month, date] = day.split("-");
  return year && month && date ? `${date}/${month}/${year}` : day;
}

/** Forecast accuracy: the mean error per day, or "Non évaluable" when it cannot be judged. */
export function formatAccuracy(mae: number | null, evaluable: boolean): string {
  if (!evaluable || mae === null) return "Non évaluable";
  return `± ${mae.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} u./jour`;
}

/** "Dernière vente le 25/08/2026 (il y a 38 jours)" - or "" when the date is unknown. */
export function formatLastSale(lastSaleDate: string | null, daysSince: number | null): string {
  if (!lastSaleDate) return "";
  const [year, month, day] = lastSaleDate.split("-");
  const date = `${day}/${month}/${year}`;
  if (daysSince === null || daysSince <= 0) return `Dernière vente le ${date}`;
  return `Dernière vente le ${date} (${daysSince} jour${daysSince > 1 ? "s" : ""} sans vente)`;
}

export const RELIABILITY_LABEL: Record<ForecastReliability, string> = {
  sufficient: "Fiable",
  limited: "Limitée",
  very_limited: "Très limitée",
  none: "Aucune donnée",
};

export const RELIABILITY_BADGE_CLASS: Record<ForecastReliability, string> = {
  sufficient: "border-emerald-200 bg-emerald-50 text-emerald-700",
  limited: "border-amber-200 bg-amber-50 text-amber-700",
  very_limited: "border-orange-200 bg-orange-50 text-orange-700",
  none: "border-slate-200 bg-slate-50 text-slate-600",
};

/** The banner text for each overall quality level. */
export const QUALITY_MESSAGE: Record<ForecastQuality, string> = {
  sufficient: "Historique suffisant pour la majorité des produits.",
  limited:
    "Qualité limitée : l'historique de ventes est court ou irrégulier pour une bonne partie des produits. Utilisez ces chiffres comme tendance.",
  insufficient:
    "Données insuffisantes : aucun produit n'a assez d'historique pour une prévision fiable. Les valeurs ci-dessous sont purement indicatives.",
};
