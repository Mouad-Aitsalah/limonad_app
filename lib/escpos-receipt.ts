/**
 * ESC/POS ticket for an 80 mm thermal printer (Bluetooth printing from the
 * Android driver app). Pure TypeScript: no Android, no DOM, no network - the
 * ticket is built from the sale already on screen (SaleDto, online or a local
 * offline sale), so it prints with or without Internet.
 *
 * SAME DATA AS THE WEB TICKET (components/pos/receipt-print.tsx), nothing
 * recomputed: lines, totals and payment come from the SaleDto as they are; the
 * unit price printed is receiptUnitPriceTTC (catalogue price minus the line's
 * discount, rebuilt from the totals really charged) - so no "Remise" line ever
 * exists here, exactly like the web ticket. Same rules as the web ticket:
 * no "EN ATTENTE DE REGLEMENT" box on top (the footer "Statut" line stays),
 * column titles at the ticket's base size, row VALUES ~1.3x. Thermal-specific
 * layout (asked after a real print test): a clear gap between QTE and
 * DESIGNATION, and the total as "TOTAL TTC" on the left, the amount on the right.
 *
 * Sizes: ESC/POS only knows integer multiples, so the web ratio (10px titles,
 * 13px values) is reproduced with the printer's two built-in fonts: font B
 * (9x17 dots) for the titles and font A (12x24 dots) for the values - a 1.33x
 * ratio, i.e. the requested ~1.3x.
 *
 * Text encoding: Latin text uses a printer code page (PC858 by default, index
 * 19, which has every French accent). Anything the code page cannot print
 * (Arabic, other scripts) is not sent as text: that ONE line is rendered as an
 * image (ESC/POS raster) by an injected renderer. The whole ticket is never an
 * image.
 */

import { receiptUnitPriceTTC } from "@/lib/receipt-line-price";
import { formatCustomerCode } from "@/lib/customer-code";
import { formatCurrency } from "@/lib/utils";
import type { SaleDto } from "@/types/operations-dto";

// ---------------------------------------------------------------------------
// Geometry (80 mm paper, 576 printable dots, 203 dpi)
// ---------------------------------------------------------------------------

export const PRINTABLE_DOTS = 576;
export const COLUMNS_FONT_A = 48; // 12 dots per character
export const COLUMNS_FONT_B = 64; // 9 dots per character

// ---------------------------------------------------------------------------
// Encodings
// ---------------------------------------------------------------------------

export type CodePageName = "cp858" | "cp1252";

/** ESC t n values (Epson numbering, what nearly every 80 mm printer follows). */
const CODE_PAGE_INDEX: Record<CodePageName, number> = { cp858: 19, cp1252: 16 };

/** IBM 858 = CP850 with the euro sign; only the letters/symbols a French ticket needs. */
const CP858_MAP = new Map<string, number>();
(() => {
  const low = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»";
  for (let i = 0; i < low.length; i += 1) CP858_MAP.set(low[i], 0x80 + i);
  const pairs: Array<[string, number]> = [
    ["Á", 0xb5], ["Â", 0xb6], ["À", 0xb7], ["©", 0xb8], ["¢", 0xbd], ["¥", 0xbe],
    ["ã", 0xc6], ["Ã", 0xc7], ["¤", 0xcf], ["ð", 0xd0], ["Ð", 0xd1], ["Ê", 0xd2],
    ["Ë", 0xd3], ["È", 0xd4], ["€", 0xd5], ["Í", 0xd6], ["Î", 0xd7], ["Ï", 0xd8],
    ["¦", 0xdd], ["Ì", 0xde], ["Ó", 0xe0], ["ß", 0xe1], ["Ô", 0xe2], ["Ò", 0xe3],
    ["õ", 0xe4], ["Õ", 0xe5], ["µ", 0xe6], ["þ", 0xe7], ["Þ", 0xe8], ["Ú", 0xe9],
    ["Û", 0xea], ["Ù", 0xeb], ["ý", 0xec], ["Ý", 0xed], ["¯", 0xee], ["´", 0xef],
    ["±", 0xf1], ["¾", 0xf3], ["¶", 0xf4], ["§", 0xf5], ["÷", 0xf6], ["¸", 0xf7],
    ["°", 0xf8], ["¨", 0xf9], ["·", 0xfa], ["¹", 0xfb], ["³", 0xfc], ["²", 0xfd],
  ];
  for (const [char, code] of pairs) CP858_MAP.set(char, code);
})();

/** Typographic characters replaced by a plain equivalent before encoding. */
function simplify(text: string): string {
  return text
    .replace(/[    ]/g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[‎‏]/g, "");
}

/** Byte of one character in the code page, or null when the printer cannot print it. */
export function encodeChar(char: string, codePage: CodePageName): number | null {
  const code = char.codePointAt(0) ?? 0;
  if (code >= 0x20 && code <= 0x7e) return code;
  if (codePage === "cp1252") {
    if (code >= 0xa0 && code <= 0xff) return code;
    if (char === "€") return 0x80;
    return null;
  }
  return CP858_MAP.get(char) ?? null;
}

export function isEncodable(text: string, codePage: CodePageName = "cp858"): boolean {
  for (const char of simplify(text)) if (encodeChar(char, codePage) === null) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Line model
// ---------------------------------------------------------------------------

export type Align = "left" | "center" | "right";

export type ReceiptLine =
  | {
      kind: "text";
      /** Already padded/aligned by us for column layouts (align "left"). */
      text: string;
      font: "A" | "B";
      bold?: boolean;
      /** Double height only (GS ! 0x01): same columns, taller glyphs. */
      tall?: boolean;
      /** Double width AND height (GS ! 0x11): half the columns. */
      big?: boolean;
      align?: Align;
      codePage?: CodePageName;
      /**
       * Column layout: each cell is printed at an ABSOLUTE position in dots from
       * the left margin (ESC $), not with spaces. `text` is then only a
       * character-grid preview of the same layout (used by tests and logs).
       */
      cells?: Array<{ x: number; text: string }>;
    }
  | { kind: "raster"; text: string; fontPx: number; bold?: boolean; align: Align }
  | { kind: "feed"; lines: number };

export type ReceiptOptions = {
  /** Set only for a local offline ticket: prints its own marker, like the web ticket. */
  offlineReference?: string | null;
  brandName?: string;
  codePage?: CodePageName;
};

const DEFAULT_BRAND = "AITSALAH STORE";

const paymentLabels: Record<string, string> = {
  CASH: "Espèces",
  CARD: "Carte",
  CHECK: "Chèque",
  BANK_TRANSFER: "Virement",
  CREDIT: "Crédit",
  MIXED: "Paiement mixte",
};

const normalizeSpaces = (value: string) => simplify(value);

function money(value: number): string {
  return normalizeSpaces(formatCurrency(value));
}

/** Same as the web ticket's formatReceiptAmount: the amount without the "DH". */
function amount(value: number): string {
  return money(value).replace(/\s?DH$/, "");
}

function formatDate(value: string): string {
  return normalizeSpaces(
    new Intl.DateTimeFormat("fr-MA", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value)),
  );
}

function formatTime(value: string): string {
  return normalizeSpaces(
    new Intl.DateTimeFormat("fr-MA", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(value)),
  );
}

/** left ... right on one line of `width` columns (left is cut first if they collide). */
function leftRight(left: string, right: string, width: number): string {
  const room = width - right.length - 1;
  const cut = left.length > room ? left.slice(0, Math.max(0, room)) : left;
  return cut + " ".repeat(Math.max(1, width - cut.length - right.length)) + right;
}

/** Wraps at `width`, at most `maxLines` lines; the last one ends with ".." if cut. */
function wrap(text: string, width: number, maxLines: number): string[] {
  const words = simplify(text).trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  const flush = () => {
    if (current) lines.push(current);
    current = "";
  };
  for (const word of words) {
    let rest = word;
    while (rest.length > width) {
      flush();
      lines.push(rest.slice(0, width));
      rest = rest.slice(width);
    }
    if (!current) current = rest;
    else if (current.length + 1 + rest.length <= width) current += ` ${rest}`;
    else {
      flush();
      current = rest;
    }
  }
  flush();
  if (lines.length <= maxLines) return lines.length ? lines : [""];
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1];
  kept[maxLines - 1] = (last.length > width - 2 ? last.slice(0, width - 2) : last) + "..";
  return kept;
}

const RULE_A = "-".repeat(COLUMNS_FONT_A);

const CHAR_DOTS_A = 12;
const CHAR_DOTS_B = 9;

/** Character-grid preview of absolutely positioned cells (for tests / logs only). */
function previewCells(cells: Array<{ x: number; text: string }>, charDots: number, columns: number): string {
  const grid = Array.from({ length: columns }, () => " ");
  for (const cell of cells) {
    const start = Math.round(cell.x / charDots);
    for (let i = 0; i < cell.text.length && start + i < columns; i += 1) grid[start + i] = cell.text[i];
  }
  return grid.join("").trimEnd();
}

function columnsLine(
  font: "A" | "B",
  cells: Array<{ x: number; text: string }>,
  extra: { bold?: boolean; codePage?: CodePageName } = {},
): ReceiptLine {
  const charDots = font === "B" ? CHAR_DOTS_B : CHAR_DOTS_A;
  const columns = font === "B" ? COLUMNS_FONT_B : COLUMNS_FONT_A;
  return { kind: "text", font, text: previewCells(cells, charDots, columns), cells, ...extra };
}

/** DESIGNATION / product names start this far from the left margin (dots): twice the old QTE -> DESIGNATION gap. */
const NAME_X_MIN = 117;

// ---------------------------------------------------------------------------
// The ticket (same content as ReceiptPrint)
// ---------------------------------------------------------------------------

export function buildReceiptLines(sale: SaleDto, options: ReceiptOptions = {}): ReceiptLine[] {
  const codePage = options.codePage ?? "cp858";
  const offlineReference = options.offlineReference ?? null;
  const lines: ReceiptLine[] = [];

  /** A text line, or a raster line when the printer cannot print it. */
  function textOrRaster(text: string, style: { align?: Align; bold?: boolean; fontPx?: number } = {}): ReceiptLine {
    const clean = normalizeSpaces(text);
    if (isEncodable(clean, codePage)) {
      return { kind: "text", text: clean, font: "A", bold: style.bold, align: style.align ?? "left", codePage };
    }
    return { kind: "raster", text: clean, fontPx: style.fontPx ?? 24, bold: style.bold, align: style.align ?? "left" };
  }

  const receiptDate = sale.validatedAt ?? sale.createdAt;
  const articleCount = sale.lines.reduce((sum, line) => sum + line.quantity, 0);
  const customerName = sale.customer?.name ?? "Client Comptoir";
  const customerCode = sale.customer ? formatCustomerCode(sale.customer.code) : null;
  const cashierName = sale.driver?.name ?? sale.createdByUserName;
  const paymentLabel = paymentLabels[sale.paymentMethod] ?? sale.paymentMethod;
  const cashAmount = sale.payments.filter((p) => p.method === "CASH").reduce((s, p) => s + p.amount, 0);
  const chequeAmount = sale.payments.filter((p) => p.method === "CHECK").reduce((s, p) => s + p.amount, 0);
  const awaitingPayment = sale.status === "DRAFT";

  // Header
  lines.push({ kind: "text", text: options.brandName ?? DEFAULT_BRAND, font: "A", bold: true, big: true, align: "center", codePage });
  lines.push({ kind: "feed", lines: 1 });

  // Meta (invoice number + date, client + time, client number)
  const numberLabel = offlineReference ? "Référence : " : "N° Facture : ";
  lines.push(textOrRaster(leftRight(`${numberLabel}${offlineReference ?? sale.displayNumber}`, formatDate(receiptDate), COLUMNS_FONT_A)));
  const clientText = `Client : ${customerName}`;
  if (isEncodable(clientText, codePage)) {
    lines.push(textOrRaster(leftRight(clientText, formatTime(receiptDate), COLUMNS_FONT_A)));
  } else {
    lines.push(textOrRaster(clientText));
    lines.push(textOrRaster(formatTime(receiptDate), { align: "right" }));
  }
  if (customerCode) lines.push(textOrRaster(`N° client : ${customerCode}`));

  if (offlineReference) {
    lines.push({ kind: "text", text: "TICKET HORS CONNEXION", font: "A", bold: true, align: "center", codePage });
  }

  lines.push({ kind: "text", text: RULE_A, font: "A" });

  // Column widths: font A (values). Numbers never lose digits: columns widen to fit.
  const unitPrices = sale.lines.map((line) => amount(receiptUnitPriceTTC(line)));
  const lineAmounts = sale.lines.map((line) => amount(line.totalTTC));
  // Real column positions (dots from the left margin, ESC $), not runs of spaces:
  //   QTE          x = 0, left aligned (the quantity sits under its title)
  //   DESIGNATION  x = nameX, the SAME x for the title and every product name
  //   Prix TTC     right edge at priceEdge   (unchanged position)
  //   Montant      right edge at the paper edge (unchanged position)
  const priceW = Math.max(9, ...unitPrices.map((value) => value.length));
  const amountW = Math.max(10, ...lineAmounts.map((value) => value.length));
  const priceEdge = (COLUMNS_FONT_A - amountW - 1) * CHAR_DOTS_A;
  const longestQty = Math.max(1, ...sale.lines.map((line) => String(line.quantity).length));
  // A very long quantity pushes the name column right instead of touching it.
  const nameX = Math.max(NAME_X_MIN, longestQty * CHAR_DOTS_A + 60);
  const nameW = Math.max(8, Math.floor((priceEdge - priceW * CHAR_DOTS_A - CHAR_DOTS_A - nameX) / CHAR_DOTS_A));

  // Titles: font B (base size), on the same x positions as the values.
  lines.push(
    columnsLine(
      "B",
      [
        { x: 0, text: "QTE" },
        { x: nameX, text: "DESIGNATION" },
        { x: priceEdge - "Prix TTC".length * CHAR_DOTS_B, text: "Prix TTC" },
        { x: PRINTABLE_DOTS - "Montant".length * CHAR_DOTS_B, text: "Montant" },
      ],
      { bold: true },
    ),
  );
  lines.push({ kind: "text", text: RULE_A, font: "A" });

  // Rows: font A (values, ~1.3x the title size)
  const numberCells = (quantity: string, price: string, total: string) => [
    { x: 0, text: quantity },
    { x: priceEdge - price.length * CHAR_DOTS_A, text: price },
    { x: PRINTABLE_DOTS - total.length * CHAR_DOTS_A, text: total },
  ];
  sale.lines.forEach((line, index) => {
    const price = unitPrices[index];
    const total = lineAmounts[index];
    const nameEncodable = isEncodable(line.productName, codePage);
    if (nameEncodable) {
      const parts = wrap(line.productName, nameW, 2);
      parts.forEach((part, partIndex) => {
        const cells =
          partIndex === 0
            ? [numberCells(String(line.quantity), price, total)[0], { x: nameX, text: part }, ...numberCells("", price, total).slice(1)]
            : [{ x: nameX, text: part }];
        lines.push(columnsLine("A", cells, { codePage }));
      });
    } else {
      // The name cannot be printed as text (e.g. Arabic): it goes as an image
      // line, the numbers stay text on their own line.
      lines.push({ kind: "raster", text: normalizeSpaces(line.productName), fontPx: 24, align: "left" });
      lines.push(columnsLine("A", numberCells(String(line.quantity), price, total), { codePage }));
    }
  });

  lines.push({ kind: "text", text: RULE_A, font: "A" });

  // Total: "TOTAL TTC" LEFT, the amount RIGHT (aligned with the Montant column), same line.
  lines.push({
    kind: "text",
    text: leftRight("TOTAL TTC", money(sale.totalTTC), COLUMNS_FONT_A),
    font: "A",
    bold: true,
    tall: true,
    codePage,
  });
  lines.push({ kind: "text", text: RULE_A, font: "A" });

  // Footer (same lines and conditions as the web ticket)
  const footer: string[] = [];
  if (awaitingPayment) {
    footer.push("Statut : EN ATTENTE DE RÈGLEMENT");
  } else {
    footer.push(`Paiement : ${paymentLabel}`);
    if (sale.paymentMethod === "BANK_TRANSFER" && sale.bankAccountingAccountCode) {
      footer.push(`Compte bancaire : ${sale.bankAccountingAccountCode} - ${sale.bankAccountingAccountName}`);
    }
    if (sale.paymentMethod === "MIXED") {
      footer.push(`Espèces : ${money(cashAmount)}`);
      footer.push(`Chèque : ${money(chequeAmount)}`);
      footer.push(`Payé : ${money(sale.paidAmount)}`);
      if (sale.creditAmount > 0) footer.push(`Reste à crédit : ${money(sale.creditAmount)}`);
    }
    footer.push(
      `Statut : ${sale.creditAmount <= 0 ? "Réglée" : sale.paidAmount > 0 ? "Partiellement réglée" : "À crédit"}`,
    );
  }
  footer.push(`Caisse : ${cashierName}`);
  footer.push(`${articleCount} Article${articleCount > 1 ? "s" : ""}`);
  if (offlineReference) footer.push("Numéro définitif attribué après synchronisation.");
  for (const text of footer) {
    for (const part of text.length > COLUMNS_FONT_A && isEncodable(text, codePage) ? wrap(text, COLUMNS_FONT_A, 3) : [text]) {
      lines.push(textOrRaster(part));
    }
  }

  lines.push({ kind: "feed", lines: 4 });
  return lines;
}

/** The self-test ticket: prints what THIS printer really accepts. */
export function buildTestReceiptLines(input: { printerName: string; codePage?: CodePageName }): ReceiptLine[] {
  const codePage = input.codePage ?? "cp858";
  const rule = "-".repeat(COLUMNS_FONT_A);
  const t = (text: string, extra: Partial<Extract<ReceiptLine, { kind: "text" }>> = {}): ReceiptLine => ({
    kind: "text",
    text,
    font: "A",
    codePage,
    ...extra,
  });
  return [
    t(rule),
    t("COMDIS", { bold: true, big: true, align: "center" }),
    t("TEST IMPRESSION", { bold: true, align: "center" }),
    t(rule),
    { kind: "feed", lines: 1 },
    isEncodable(`Imprimante : ${input.printerName}`, codePage)
      ? t(`Imprimante : ${input.printerName}`)
      : { kind: "raster", text: `Imprimante : ${input.printerName}`, fontPx: 24, align: "left" },
    t("Bluetooth : OK"),
    { kind: "feed", lines: 1 },
    t("Accents (PC858) :"),
    t("é è à ç ù ô É È À Ç", { codePage: "cp858" }),
    t("Accents (WPC1252) :"),
    t("é è à ç ù ô É È À Ç", { codePage: "cp1252" }),
    { kind: "feed", lines: 1 },
    t("Arabe (image) :"),
    { kind: "raster", text: "اختبار الطباعة", fontPx: 30, align: "center" },
    { kind: "feed", lines: 1 },
    t(rule),
    t("FIN DU TEST", { align: "center" }),
    t(rule),
    { kind: "feed", lines: 4 },
  ];
}

// ---------------------------------------------------------------------------
// Encoding to ESC/POS bytes
// ---------------------------------------------------------------------------

/** A 1-bit-per-pixel image: rows packed MSB first, 1 = black. */
export type RasterImage = { width: number; height: number; data: Uint8Array };

export type RasterRenderer = (
  text: string,
  options: { widthDots: number; fontPx: number; bold?: boolean; align: Align },
) => RasterImage | null;

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** GS v 0: raster bit image, sent in bands so a small printer buffer never overflows. */
export function rasterToEscPos(image: RasterImage): number[] {
  const bytesPerRow = Math.ceil(image.width / 8);
  const out: number[] = [];
  const band = 96;
  for (let y = 0; y < image.height; y += band) {
    const rows = Math.min(band, image.height - y);
    out.push(GS, 0x76, 0x30, 0x00, bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff, rows & 0xff, (rows >> 8) & 0xff);
    for (let i = y * bytesPerRow; i < (y + rows) * bytesPerRow; i += 1) out.push(image.data[i] ?? 0);
  }
  return out;
}

export type EncodeResult = { bytes: Uint8Array; rasterLines: number; unrenderedLines: string[] };

export function encodeReceipt(lines: ReceiptLine[], raster?: RasterRenderer): EncodeResult {
  // ESC @ : initialise, then GS P 203 203: horizontal/vertical motion unit = 1 dot at 203 dpi,
  // so ESC $ positions below are exact dots on every 80 mm printer.
  const out: number[] = [ESC, 0x40, GS, 0x50, 203, 203];
  let currentCodePage: CodePageName | null = null;
  let rasterLines = 0;
  const unrenderedLines: string[] = [];

  for (const line of lines) {
    if (line.kind === "feed") {
      out.push(ESC, 0x64, Math.max(0, Math.min(255, line.lines))); // ESC d n
      continue;
    }

    if (line.kind === "raster") {
      const image = raster?.(line.text, { widthDots: PRINTABLE_DOTS, fontPx: line.fontPx, bold: line.bold, align: line.align }) ?? null;
      if (!image) {
        // No renderer / rendering failed: never send garbage, print a readable placeholder.
        unrenderedLines.push(line.text);
        out.push(ESC, 0x61, 0x00, ESC, 0x4d, 0x00);
        for (const char of "[texte non imprimable]") out.push(encodeChar(char, "cp858") ?? 0x3f);
        out.push(LF);
        continue;
      }
      rasterLines += 1;
      out.push(ESC, 0x61, 0x00); // left: the image already carries its own alignment
      out.push(...rasterToEscPos(image));
      continue;
    }

    const codePage = line.codePage ?? "cp858";
    if (currentCodePage !== codePage) {
      out.push(ESC, 0x74, CODE_PAGE_INDEX[codePage]); // ESC t n
      currentCodePage = codePage;
    }
    out.push(ESC, 0x4d, line.font === "B" ? 0x01 : 0x00); // ESC M : font
    out.push(ESC, 0x45, line.bold ? 0x01 : 0x00); // ESC E : bold
    out.push(GS, 0x21, line.big ? 0x11 : line.tall ? 0x01 : 0x00); // GS ! : size
    out.push(ESC, 0x61, line.align === "center" ? 0x01 : line.align === "right" ? 0x02 : 0x00); // ESC a
    if (line.cells) {
      // Absolute column positions: ESC $ nL nH, then the cell's text.
      for (const cell of line.cells) {
        const x = Math.max(0, Math.min(PRINTABLE_DOTS - 1, Math.round(cell.x)));
        out.push(ESC, 0x24, x & 0xff, x >> 8);
        for (const char of simplify(cell.text)) out.push(encodeChar(char, codePage) ?? 0x3f);
      }
    } else {
      for (const char of simplify(line.text)) out.push(encodeChar(char, codePage) ?? 0x3f); // '?' never reached for checked lines
    }
    out.push(LF);
    // reset emphasis so it never leaks into the next line
    out.push(ESC, 0x45, 0x00, GS, 0x21, 0x00);
  }

  out.push(GS, 0x56, 0x42, 0x00); // GS V 66 0 : feed and partial cut
  return { bytes: Uint8Array.from(out), rasterLines, unrenderedLines };
}

export function buildReceiptEscPos(sale: SaleDto, options: ReceiptOptions & { raster?: RasterRenderer } = {}): EncodeResult {
  return encodeReceipt(buildReceiptLines(sale, options), options.raster);
}

export function buildTestEscPos(input: { printerName: string; raster?: RasterRenderer }): EncodeResult {
  return encodeReceipt(buildTestReceiptLines({ printerName: input.printerName }), input.raster);
}
