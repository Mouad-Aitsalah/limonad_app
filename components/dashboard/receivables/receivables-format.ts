import type { AgingBucketKey } from "@/types/receivables";

/** Colours of the aging buckets (chart, legend, table). */
export const BUCKET_STYLES: Record<AgingBucketKey, { bar: string; dot: string; label: string }> = {
  "0-30": { bar: "#34d399", dot: "bg-emerald-400", label: "0 à 30 jours" },
  "31-60": { bar: "#fbbf24", dot: "bg-amber-400", label: "31 à 60 jours" },
  "61-90": { bar: "#fb923c", dot: "bg-orange-400", label: "61 à 90 jours" },
  "90+": { bar: "#f87171", dot: "bg-red-400", label: "Plus de 90 jours" },
};

export const ESTIMATE_NOTE =
  "Répartition estimative : les règlements étant enregistrés sur le compte du client et non sur une facture, les avoirs et règlements sont imputés aux ventes à crédit les plus anciennes (FIFO). Ce n'est pas l'affectation comptable réelle des règlements aux factures ; le solde, lui, est exact.";

export const CASH_REFUND_NOT_DEDUCTED_HINT =
  "Remboursements en espèces validés depuis la règle « un remboursement en espèces est indépendant de la dette à crédit » : l'argent sort de la caisse, la dette du client ne baisse pas. Seul un avoir « sur compte » réduit la dette. Ces remboursements sont listés dans le détail de chaque client, avec un effet de 0 sur son solde.";

export const CASH_NOTE_HINT =
  "Avoirs clients validés enregistrés avec la méthode de remboursement « espèces ». Le calcul actuel du solde (le même que « Solde clients » et le Dashboard) les déduit de ce que doit le client. Cette méthode n'est jamais choisie à la saisie d'un avoir : c'est la valeur par défaut de la base. Vérifiez au cas par cas si le client a réellement été remboursé en espèces.";

/** "2026-09-01" -> "01/09/2026" */
export function formatDay(day: string | null | undefined): string {
  if (!day) return "—";
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
}

export function formatDays(days: number | null | undefined): string {
  if (days === null || days === undefined) return "—";
  return days <= 1 ? `${days} jour` : `${days} jours`;
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Actif",
  INACTIVE: "Inactif",
  BLOCKED: "Bloqué",
  CREDIT: "À crédit",
  PARTIALLY_PAID: "Partiellement payée",
  PAID: "Payée",
  CANCELLED: "Annulée",
  DRAFT: "Brouillon",
  VALIDATED: "Validée",
  CREDIT_NOTED: "Avoir",
};

export function statusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return STATUS_LABELS[status] ?? status;
}

const METHOD_LABELS: Record<string, string> = {
  CASH: "Espèces",
  CHECK: "Chèque",
  BANK_TRANSFER: "Virement",
  CARD: "Carte",
  MIXED: "Mixte",
  CREDIT: "Crédit",
};

export function methodLabel(method: string | null | undefined): string {
  if (!method) return "—";
  return METHOD_LABELS[method] ?? method;
}

/**
 * How a customer credit note was settled (CreditNote.refundMethod), in the words of the credit-note form:
 * CASH = cash refunded from the till, BANK = credited to the customer's account (« Avoir sur compte client »).
 * Kept apart from methodLabel, which labels the payment methods of the settlements.
 */
export function refundMethodLabel(method: "CASH" | "BANK"): string {
  return method === "BANK" ? "Avoir sur compte client" : "Espèces";
}
