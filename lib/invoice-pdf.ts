import { reconstructDiscountUnitAmount, unitPriceTTCFromHT } from "@/lib/pos-discount";
import { formatCurrency } from "@/lib/utils";
import type { SaleDto } from "@/types/operations-dto";

type CompanyIdentityForInvoice = {
  name?: string | null;
  tradeName?: string | null;
  logoUrl?: string | null;
};

export type InvoicePdfInput = {
  sale: SaleDto;
  identity?: CompanyIdentityForInvoice | null;
  customerPhone?: string | null;
};

const PAYMENT_LABELS: Record<string, string> = {
  CASH: "Espèces",
  CARD: "Carte",
  CHECK: "Chèque",
  BANK_TRANSFER: "Virement",
  CREDIT: "Crédit",
  MIXED: "Paiement mixte",
};

// Kept deliberately small so a long invoice is divided into proper A5 pages
// rather than slicing a row in half when it is converted to an image.
const LINES_PER_PAGE = 7;

function invoiceDate(value: string): string {
  return new Intl.DateTimeFormat("fr-MA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function invoiceTime(value: string): string {
  return new Intl.DateTimeFormat("fr-MA", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function text(value: string, className?: string): HTMLSpanElement {
  const node = document.createElement("span");
  node.textContent = value;
  if (className) node.className = className;
  return node;
}

function appendMetaRow(container: HTMLElement, label: string, value: string) {
  const row = document.createElement("div");
  row.className = "invoice-pdf-meta-row";
  row.append(text(label, "invoice-pdf-label"), text(value, "invoice-pdf-value"));
  container.append(row);
}

function appendLineHeader(container: HTMLElement) {
  const header = document.createElement("div");
  header.className = "invoice-pdf-line invoice-pdf-line-header";
  header.append(
    text("Qté", "invoice-pdf-quantity"),
    text("Désignation", "invoice-pdf-product"),
    text("Prix TTC", "invoice-pdf-money"),
    text("Montant", "invoice-pdf-money"),
  );
  container.append(header);
}

function appendSaleLine(container: HTMLElement, line: SaleDto["lines"][number]) {
  const row = document.createElement("div");
  row.className = "invoice-pdf-sale-line";
  const values = document.createElement("div");
  values.className = "invoice-pdf-line";
  const unitPriceTTC = unitPriceTTCFromHT(line.unitPriceHT, line.taxRate);
  const discountUnitAmount = reconstructDiscountUnitAmount({
    unitPriceHT: line.unitPriceHT,
    taxRate: line.taxRate,
    quantity: line.quantity,
    totalTTC: line.totalTTC,
  });

  values.append(
    text(String(line.quantity), "invoice-pdf-quantity"),
    text(line.productName, "invoice-pdf-product"),
    text(formatCurrency(unitPriceTTC), "invoice-pdf-money"),
    text(formatCurrency(line.totalTTC), "invoice-pdf-money"),
  );
  row.append(values);

  if (discountUnitAmount > 0) {
    row.append(text(`Remise : ${formatCurrency(discountUnitAmount)}/u`, "invoice-pdf-discount"));
  }

  container.append(row);
}

function addInvoiceStyles(page: HTMLElement) {
  page.style.cssText = [
    "box-sizing:border-box",
    "width:740px",
    "min-height:930px",
    "padding:40px 42px",
    "background:#ffffff",
    "color:#182033",
    "font-family:Arial, Tahoma, sans-serif",
    "font-size:15px",
    "line-height:1.35",
  ].join(";");

  const style = document.createElement("style");
  style.textContent = `
    .invoice-pdf-header { display:flex; align-items:center; gap:18px; border-bottom:3px solid #0f7a5d; padding-bottom:18px; }
    .invoice-pdf-logo { width:84px; height:58px; object-fit:contain; object-position:left center; }
    .invoice-pdf-brand { font-size:22px; font-weight:700; color:#173156; }
    .invoice-pdf-title { margin:24px 0 18px; display:flex; justify-content:space-between; gap:16px; align-items:baseline; }
    .invoice-pdf-title strong { color:#0f7a5d; font-size:23px; }
    .invoice-pdf-title span { color:#5c667a; font-size:13px; }
    .invoice-pdf-meta { display:grid; grid-template-columns:1fr 1fr; gap:8px 28px; margin-bottom:22px; }
    .invoice-pdf-meta-row { display:flex; gap:7px; min-width:0; }
    .invoice-pdf-label { color:#5c667a; flex:0 0 auto; }
    .invoice-pdf-value { font-weight:600; min-width:0; overflow-wrap:anywhere; direction:auto; unicode-bidi:plaintext; }
    .invoice-pdf-table { border-top:1px solid #ced6e0; border-bottom:1px solid #ced6e0; }
    .invoice-pdf-line { display:grid; grid-template-columns:42px minmax(0, 1fr) 96px 104px; gap:8px; align-items:start; }
    .invoice-pdf-line-header { padding:10px 0; color:#526074; font-size:12px; font-weight:700; border-bottom:1px solid #ced6e0; text-transform:uppercase; }
    .invoice-pdf-sale-line { padding:11px 0; border-bottom:1px solid #e7ebf0; }
    .invoice-pdf-sale-line:last-child { border-bottom:0; }
    .invoice-pdf-quantity { text-align:center; font-variant-numeric:tabular-nums; }
    .invoice-pdf-product { min-width:0; font-weight:600; overflow-wrap:anywhere; direction:auto; unicode-bidi:plaintext; }
    .invoice-pdf-money { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
    .invoice-pdf-discount { display:block; margin:4px 0 0 50px; color:#a14a00; font-size:12px; }
    .invoice-pdf-summary { width:300px; margin:22px 0 0 auto; }
    .invoice-pdf-summary-row { display:flex; justify-content:space-between; gap:16px; margin-top:8px; }
    .invoice-pdf-grand-total { margin-top:12px; padding-top:12px; border-top:2px solid #0f7a5d; color:#0f7a5d; font-size:19px; font-weight:700; }
    .invoice-pdf-payment { margin-top:26px; padding-top:16px; border-top:1px solid #ced6e0; }
    .invoice-pdf-thanks { margin-top:30px; text-align:center; color:#526074; font-size:13px; }
  `;
  page.append(style);
}

function createInvoicePage({
  input,
  lines,
  pageNumber,
  isLastPage,
}: {
  input: InvoicePdfInput;
  lines: SaleDto["lines"];
  pageNumber: number;
  isLastPage: boolean;
}): HTMLElement {
  const { sale, identity, customerPhone } = input;
  const date = sale.validatedAt ?? sale.createdAt;
  const brand = identity?.tradeName?.trim() || identity?.name?.trim() || "COMDIS";
  const page = document.createElement("section");
  addInvoiceStyles(page);

  const header = document.createElement("header");
  header.className = "invoice-pdf-header";
  if (identity?.logoUrl) {
    const logo = document.createElement("img");
    logo.className = "invoice-pdf-logo";
    logo.src = identity.logoUrl;
    logo.alt = "";
    logo.crossOrigin = "anonymous";
    header.append(logo);
  }
  header.append(text(brand, "invoice-pdf-brand"));
  page.append(header);

  const title = document.createElement("div");
  title.className = "invoice-pdf-title";
  title.append(
    text(`FACTURE N° ${sale.displayNumber}`),
    text(pageNumber > 1 ? `Page ${pageNumber}` : "Original"),
  );
  page.append(title);

  const meta = document.createElement("div");
  meta.className = "invoice-pdf-meta";
  appendMetaRow(meta, "Date :", invoiceDate(date));
  appendMetaRow(meta, "Heure :", invoiceTime(date));
  appendMetaRow(meta, "Client :", sale.customer?.name ?? "Client comptoir");
  if (customerPhone) appendMetaRow(meta, "Téléphone :", customerPhone);
  page.append(meta);

  const table = document.createElement("div");
  table.className = "invoice-pdf-table";
  appendLineHeader(table);
  lines.forEach((line) => appendSaleLine(table, line));
  page.append(table);

  if (isLastPage) {
    const summary = document.createElement("div");
    summary.className = "invoice-pdf-summary";
    const subtotal = document.createElement("div");
    subtotal.className = "invoice-pdf-summary-row";
    subtotal.append(text("Total HT"), text(formatCurrency(sale.subtotalHT), "invoice-pdf-money"));
    const tax = document.createElement("div");
    tax.className = "invoice-pdf-summary-row";
    tax.append(text("TVA"), text(formatCurrency(sale.taxAmount), "invoice-pdf-money"));
    const total = document.createElement("div");
    total.className = "invoice-pdf-summary-row invoice-pdf-grand-total";
    total.append(text("Total TTC"), text(formatCurrency(sale.totalTTC), "invoice-pdf-money"));
    summary.append(subtotal, tax, total);
    page.append(summary);

    const payment = document.createElement("div");
    payment.className = "invoice-pdf-payment";
    payment.append(text(`Mode de règlement : ${PAYMENT_LABELS[sale.paymentMethod] ?? sale.paymentMethod}`));
    page.append(payment);
    page.append(text("Merci pour votre confiance.", "invoice-pdf-thanks"));
  }

  return page;
}

async function captureInvoicePage(page: HTMLElement, html2canvas: typeof import("html2canvas").default) {
  try {
    return await html2canvas(page, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true,
      logging: false,
      imageTimeout: 2_500,
    });
  } catch {
    // A logo hosted without CORS headers must never prevent issuing an invoice.
    page.querySelectorAll("img").forEach((image) => image.remove());
    return html2canvas(page, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true,
      logging: false,
    });
  }
}

/**
 * Builds an A5 portrait PDF from an already persisted sale. The invoice is
 * rendered by the browser before it is embedded in the PDF, so browser font
 * shaping keeps Arabic customer and product names intact without shipping a
 * second, incomplete font model to the application.
 */
export async function generateInvoicePdf(input: InvoicePdfInput): Promise<Blob> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("La génération de facture PDF est disponible uniquement dans l’application.");
  }

  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);
  await document.fonts?.ready;

  const chunks: SaleDto["lines"][] = [];
  for (let index = 0; index < input.sale.lines.length; index += LINES_PER_PAGE) {
    chunks.push(input.sale.lines.slice(index, index + LINES_PER_PAGE));
  }
  if (chunks.length === 0) chunks.push([]);

  const staging = document.createElement("div");
  staging.style.cssText = "position:fixed;left:-10000px;top:0;z-index:-1;pointer-events:none;";
  document.body.append(staging);

  try {
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a5", compress: true });
    pdf.setDocumentProperties({
      title: `Facture ${input.sale.displayNumber}`,
      subject: "Facture COMDIS",
      author: input.identity?.tradeName?.trim() || input.identity?.name?.trim() || "COMDIS",
    });

    for (const [index, lines] of chunks.entries()) {
      const page = createInvoicePage({
        input,
        lines,
        pageNumber: index + 1,
        isLastPage: index === chunks.length - 1,
      });
      staging.append(page);
      const canvas = await captureInvoicePage(page, html2canvas);
      const margin = 8;
      const printableWidth = 148 - margin * 2;
      const printableHeight = 210 - margin * 2;
      const imageHeight = (canvas.height * printableWidth) / canvas.width;

      if (imageHeight > printableHeight) {
        throw new Error("Le contenu de la facture dépasse le format A5.");
      }
      if (index > 0) pdf.addPage("a5", "portrait");
      pdf.addImage(canvas, "PNG", margin, margin, printableWidth, imageHeight, undefined, "FAST");
      page.remove();
    }

    return pdf.output("blob");
  } finally {
    staging.remove();
  }
}

export function getInvoicePdfFileName(displayNumber: string): string {
  const safeNumber = displayNumber
    .normalize("NFKD")
    .replace(/[\\/\\:*?"<>|]/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `Facture-${safeNumber || "sans-numero"}.pdf`;
}
