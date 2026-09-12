import { reconstructDiscountUnitAmount } from "@/lib/pos-discount";
import { formatCurrency } from "@/lib/utils";
import type { SaleDto } from "@/types/operations-dto";

/**
 * Share-only helpers: turn an already-persisted SaleDto into a WhatsApp
 * "click to chat" link (https://wa.me/<phone>?text=<message>). Nothing here
 * creates, validates, prices, or prints a sale - it only reads fields a real
 * sale already carries (lib/sale-display-number.ts's displayNumber, the
 * lines' own persisted totalTTC) and formats them as text. Reused by the
 * driver POS and the driver sales history so both share one message format.
 */

/**
 * Normalizes a customer phone number for a wa.me link. Never touches the
 * value stored on the Customer row - this is a frontend formatting step for
 * THIS feature only, applied to a copy of the string at share time.
 *
 * Strips spaces/dashes/dots/parentheses, drops a leading "+" or "00", then
 * maps a 10-digit local Moroccan number (0X XX XX XX XX) to its "212..."
 * country-code form. Returns null when the result doesn't look like a
 * usable phone number at all, so callers can fall back to an
 * unaddressed wa.me link instead of guessing.
 */
export function normalizeWhatsAppPhone(rawPhone: string | null | undefined): string | null {
  if (!rawPhone) return null;

  let digits = rawPhone.replace(/[\s.\-()]/g, "");
  if (digits.startsWith("+")) {
    digits = digits.slice(1);
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }

  // Local Moroccan format (0612345678, 0712345678, ...) -> 212 + the 9 digits.
  if (/^0\d{9}$/.test(digits)) {
    digits = `212${digits.slice(1)}`;
  }

  return /^\d{8,15}$/.test(digits) ? digits : null;
}

function formatMessageDate(sale: SaleDto): string {
  const raw = sale.validatedAt ?? sale.createdAt;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(raw));
}

/**
 * Builds the invoice-share text. Every amount comes straight from the sale's
 * own persisted lines/total (never recomputed from discountRate), so a
 * DH-per-unit discount is reflected exactly as it was actually billed - see
 * reconstructDiscountUnitAmount's own doc in lib/pos-discount.ts.
 */
export function buildWhatsAppInvoiceMessage(
  sale: SaleDto,
  organizationName?: string | null,
): string {
  const brand = organizationName?.trim() || "COMDIS";
  const customerName = sale.customer?.name ?? "Client Comptoir";

  const productLines = sale.lines.map((line) => {
    const discountUnitAmount = reconstructDiscountUnitAmount({
      unitPriceHT: line.unitPriceHT,
      taxRate: line.taxRate,
      quantity: line.quantity,
      totalTTC: line.totalTTC,
    });
    const base = `${line.quantity} x ${line.productName} — ${formatCurrency(line.totalTTC)}`;
    return discountUnitAmount > 0
      ? `${base} (remise ${formatCurrency(discountUnitAmount)}/u)`
      : base;
  });

  return [
    "Bonjour,",
    "",
    `Voici votre facture ${brand}.`,
    "",
    `Facture : N° ${sale.displayNumber}`,
    `Date : ${formatMessageDate(sale)}`,
    `Client : ${customerName}`,
    "",
    ...productLines,
    "",
    `Total : ${formatCurrency(sale.totalTTC)}`,
    "",
    "Merci pour votre confiance.",
  ].join("\n");
}

/**
 * https://wa.me/<phone>?text=<message> when a phone is known, otherwise the
 * bare https://wa.me/?text=<message> form so WhatsApp still opens with the
 * message prefilled and lets the person pick a contact themselves.
 */
export function buildWhatsAppUrl(phone: string | null, message: string): string {
  const encoded = encodeURIComponent(message);
  return phone ? `https://wa.me/${phone}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
}
