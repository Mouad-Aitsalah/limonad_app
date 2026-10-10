import { z } from "zod";

import { resolveCustomerCodeFromInput } from "@/lib/customer-code";
import { roundMoney } from "@/lib/money";
import { computeDiscountedLineTotals } from "@/lib/pos-discount";
import { applyCommercialRounding, computeSaleTotals } from "@/lib/sale-rounding";

/**
 * Espace Client ("Commander en ligne") - the PURE rules, no database and no
 * server-only import, so they are unit-tested directly
 * (lib/client-portal-rules.test.ts).
 */

// ---------------------------------------------------------------------------
// Session / login
// ---------------------------------------------------------------------------

/** A shopping session, not a persistent login. */
export const CLIENT_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

/** Failed logins counted per key ("ip:<addr>" / "org:<code>") over this window. */
export const CLIENT_LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const CLIENT_LOGIN_MAX_FAILURES_PER_IP = 10;
export const CLIENT_LOGIN_MAX_FAILURES_PER_ORG = 30;
/** Throttle rows older than this are purged opportunistically. */
export const CLIENT_LOGIN_RETENTION_MS = 24 * 60 * 60 * 1000;

/** The single message for every failed login: never reveals which code was wrong. */
export const CLIENT_LOGIN_FAILED_MESSAGE = "Code organisation ou code client invalide.";
export const CLIENT_LOGIN_THROTTLED_MESSAGE =
  "Trop de tentatives de connexion. Votre accès est temporairement bloqué : réessayez dans 15 minutes ou contactez votre fournisseur.";

export const clientLoginSchema = z.object({
  organizationCode: z.string().trim().min(1).max(64),
  customerCode: z.string().trim().min(1).max(64),
  // Optional contact number - informative only, NEVER an identity proof.
  phone: z
    .string()
    .trim()
    .max(32)
    .optional()
    .transform((value) => value || undefined),
});

/** Organisation codes are stored as typed by the admin ("COMDIS-PRINCIPAL"): exact, then upper-cased. */
export function organizationCodeCandidates(input: string): string[] {
  const value = input.trim();
  if (!value) return [];
  return [...new Set([value, value.toUpperCase()])];
}

/**
 * Every stored Customer.code the typed value can designate - the same rule as
 * the POS "N° client" box (resolveCustomerCodeFromInput: "15", "3421/15" and
 * "342115" are the same customer), plus the exact / upper-cased value for
 * legacy codes like "CLI-0001".
 */
export function customerCodeCandidates(input: string): string[] {
  const value = input.trim();
  if (!value) return [];
  const legacy = resolveCustomerCodeFromInput(value);
  return [...new Set([value, value.toUpperCase(), ...(legacy ? [legacy] : [])])];
}

/**
 * Optional contact phone: digits, spaces, dots, dashes, parentheses and one
 * leading "+", 6 to 20 digits. Returns the cleaned value, null when empty,
 * or "invalid".
 */
export function normalizeContactPhone(input: string | null | undefined): string | null | "invalid" {
  const value = (input ?? "").trim();
  if (!value) return null;
  if (!/^\+?[\d\s.\-()]+$/.test(value)) return "invalid";
  const digits = value.replace(/\D/g, "");
  if (digits.length < 6 || digits.length > 20) return "invalid";
  return (value.startsWith("+") ? "+" : "") + digits;
}

/** First address of X-Forwarded-For, else X-Real-IP, else "unknown" (same rule as the staff login). */
export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded.slice(0, 64);
  const realIp = headers.get("x-real-ip")?.trim();
  return realIp ? realIp.slice(0, 64) : "unknown";
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

/** Prefixes a stored Product.imageUrl must start with to count as a photo (also used as the SQL filter). */
export const VALID_PHOTO_PREFIXES = [
  "data:image/png;base64,",
  "data:image/jpeg;base64,",
  "data:image/jpg;base64,",
  "data:image/webp;base64,",
  "data:image/gif;base64,",
  "https://",
  "http://",
] as const;

/** A product photo is shown only when it really is one: a non-empty base64 image or an http(s) URL with a host. */
export function isValidProductPhoto(imageUrl: string | null | undefined): boolean {
  const value = imageUrl?.trim();
  if (!value) return false;
  const prefix = VALID_PHOTO_PREFIXES.find((candidate) => value.toLowerCase().startsWith(candidate));
  if (!prefix) return false;
  if (prefix.startsWith("data:")) {
    const payload = value.slice(prefix.length);
    return payload.length >= 16 && /^[A-Za-z0-9+/=\s]+$/.test(payload);
  }
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.length > 0;
  } catch {
    return false;
  }
}

export const CLIENT_CATALOG_PAGE_SIZE = 48;

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export const CLIENT_ORDER_MAX_LINES = 100;
export const CLIENT_ORDER_MAX_QUANTITY = 999;
export const CLIENT_ORDER_MAX_PER_HOUR = 10;

export const clientOrderInputSchema = z
  .object({
    lines: z
      .array(
        z
          .object({
            productId: z.string().trim().min(1).max(64),
            quantity: z.number().int().min(1).max(CLIENT_ORDER_MAX_QUANTITY),
          })
          .strict(),
      )
      .min(1)
      .max(CLIENT_ORDER_MAX_LINES),
    note: z.string().trim().max(500).optional(),
    idempotencyKey: z.string().trim().min(8).max(120),
    // What the client saw; a different server total -> PRICE_CHANGED (409).
    expectedTotalTTC: z.number().nonnegative().max(100_000_000).optional(),
  })
  .strict();

export type ClientOrderInput = z.infer<typeof clientOrderInputSchema>;

/** One line per product (quantities summed, capped), first-seen order kept. */
export function mergeOrderLines(
  lines: Array<{ productId: string; quantity: number }>,
): Array<{ productId: string; quantity: number }> {
  const byId = new Map<string, number>();
  for (const line of lines) byId.set(line.productId, (byId.get(line.productId) ?? 0) + line.quantity);
  return [...byId].map(([productId, quantity]) => ({
    productId,
    quantity: Math.min(quantity, CLIENT_ORDER_MAX_QUANTITY),
  }));
}

export type PricedOrderLine = {
  productId: string;
  quantity: number;
  /** Catalogue price HT (Product.salePrice) - the POS's own source, never the client's. */
  unitPriceHT: number;
  taxRate: number;
};

/**
 * The estimated order amounts, computed EXACTLY like a POS sale with no
 * discount: computeDiscountedLineTotals per line, then computeSaleTotals
 * (commercial rounding of the final total to 0.50 DH).
 */
export function computeClientOrderTotals(lines: PricedOrderLine[]) {
  const computed = lines.map((line) => {
    const totals = computeDiscountedLineTotals({
      unitPriceHT: line.unitPriceHT,
      taxRate: line.taxRate,
      quantity: line.quantity,
      discountUnitAmount: 0,
    });
    return { ...line, totalHT: totals.totalHT, taxAmount: totals.taxAmount, totalTTC: totals.totalTTC };
  });
  const { subtotalHT, taxAmount, roundingAmount, totalTTC } = computeSaleTotals(computed);
  return { lines: computed, subtotalHT, taxAmount, roundingAmount, totalTTC };
}

/**
 * The same estimate computed from the catalogue TTC prices the browser has:
 * a POS line is round(quantity x unit TTC) (computeDiscountedLineTotals with
 * no discount) and the sale total is the commercial rounding of their sum -
 * so this equals computeClientOrderTotals().totalTTC for unchanged prices.
 */
export function estimateClientCartTotal(lines: Array<{ priceTTC: number; quantity: number }>) {
  const beforeRounding = lines.reduce((sum, line) => sum + roundMoney(line.quantity * line.priceTTC), 0);
  return applyCommercialRounding(beforeRounding);
}

export function totalsDiffer(a: number, b: number): boolean {
  return Math.abs(a - b) > 0.009;
}

export function formatCustomerOrderNumber(sequence: number): string {
  return `CMD-${String(sequence).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// Staff workflow
// ---------------------------------------------------------------------------

export type CustomerOrderStatusValue = "SUBMITTED" | "ACCEPTED" | "REJECTED" | "CONVERTED" | "CANCELLED";

/**
 * Allowed staff transitions. CONVERTED is never set here: only the POS sale
 * creation sets it (createCounterSale, same transaction as the sale).
 */
const STAFF_TRANSITIONS: Record<CustomerOrderStatusValue, CustomerOrderStatusValue[]> = {
  SUBMITTED: ["ACCEPTED", "REJECTED"],
  ACCEPTED: ["REJECTED"],
  REJECTED: [],
  CONVERTED: [],
  CANCELLED: [],
};

export function canStaffTransition(from: CustomerOrderStatusValue, to: CustomerOrderStatusValue): boolean {
  return STAFF_TRANSITIONS[from].includes(to);
}

/** Only an ACCEPTED order can be opened in the POS (and therefore converted). */
export function canOpenInPos(status: CustomerOrderStatusValue): boolean {
  return status === "ACCEPTED";
}

/** Shown instead of "Facturée" while the linked sale is still a pending (DRAFT) invoice. */
export const CUSTOMER_ORDER_INVOICE_PENDING_LABEL = "Facture en attente";

/**
 * The label of an order. CONVERTED means "a sale was created from it"; while
 * that sale is still a pending DRAFT invoice ("Préparer", not yet collected)
 * the order is not really invoiced yet, hence the more precise label.
 */
export function customerOrderStatusLabel(status: CustomerOrderStatusValue, invoicePending: boolean | undefined): string {
  return status === "CONVERTED" && invoicePending ? CUSTOMER_ORDER_INVOICE_PENDING_LABEL : CUSTOMER_ORDER_STATUS_LABELS[status];
}

/** Derived, never stored: CONVERTED whose linked sale is still a DRAFT. */
export function isInvoicePending(status: CustomerOrderStatusValue, linkedSaleStatus: string | null | undefined): boolean {
  return status === "CONVERTED" && linkedSaleStatus === "DRAFT";
}

export const CUSTOMER_ORDER_STATUS_LABELS: Record<CustomerOrderStatusValue, string> = {
  SUBMITTED: "À traiter",
  ACCEPTED: "Acceptée",
  REJECTED: "Refusée",
  CONVERTED: "Facturée",
  CANCELLED: "Annulée",
};
