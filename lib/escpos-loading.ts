/**
 * ESC/POS ticket of a truck LOADING ("fiche de chargement"), for the same
 * 80 mm Bluetooth thermal printer as the invoices.
 *
 * Dedicated builder: the invoice ticket (lib/escpos-receipt.ts) is not touched;
 * this file only reuses its low-level pieces - the code-page encoding, the
 * absolute column positions (ESC $), the two printer fonts, and the image
 * fallback for text the printer cannot print (Arabic). Like the invoice:
 *   - Latin text, accents and digits are native ESC/POS text;
 *   - only a product name that cannot be printed as text turns its WHOLE row
 *     into one image line (quantities stay on the same line, same columns);
 *   - it is built from the data on screen, so it prints without Internet.
 *
 * Layout (font A values 12x24 dots, font B titles 9x17 dots):
 *   PRODUIT                          CHARGE  RECHARGE
 *   Produit 1                           100       200
 * Only the initial load and the reload quantities are printed (no depot
 * stock, no theoretical / real remainder).
 */

import {
  CHAR_DOTS_A,
  CHAR_DOTS_B,
  columnsLine,
  COLUMNS_FONT_A,
  encodeReceipt,
  normalizeSpaces,
  PRINTABLE_DOTS,
  printableText,
  RULE_A,
  wrap,
  type CodePageName,
  type EncodeResult,
  type RasterCellsRenderer,
  type RasterRenderer,
  type ReceiptLine,
} from "@/lib/escpos-receipt";

export type LoadingTicketLine = {
  productName: string;
  initialQuantity: number;
  reloadedQuantity: number;
};

export type LoadingTicketInput = {
  /** ISO date or yyyy-mm-dd of the loading. */
  date: string;
  driverName?: string | null;
  /** e.g. "CAM-01 - 12345-A-1"; omitted when unknown. */
  truckLabel?: string | null;
  lines: LoadingTicketLine[];
  brandName?: string;
};

const DEFAULT_BRAND = "AITSALAH STORE";
/** Gap between the CHARGE and RECHARGE columns, in dots. */
const COLUMN_GAP_DOTS = 18;

function formatLoadingDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

export function buildLoadingReceiptLines(input: LoadingTicketInput, options: { codePage?: CodePageName } = {}): ReceiptLine[] {
  const codePage = options.codePage ?? "cp858";
  const lines: ReceiptLine[] = [];

  /** A text line, or an image line when the printer cannot print it as text. */
  const textOrRaster = (text: string): ReceiptLine => {
    const printable = printableText(text, codePage);
    return printable.encodable
      ? { kind: "text", text: printable.text, font: "A", align: "left", codePage }
      : { kind: "raster", text: normalizeSpaces(text), fontPx: 24, align: "left" };
  };

  lines.push({ kind: "text", text: input.brandName ?? DEFAULT_BRAND, font: "A", bold: true, big: true, align: "center", codePage });
  lines.push({ kind: "feed", lines: 1 });
  lines.push({ kind: "text", text: "CHARGEMENT", font: "A", bold: true, tall: true, align: "center", codePage });
  lines.push({ kind: "text", text: RULE_A, font: "A" });
  lines.push(textOrRaster(`Date : ${formatLoadingDate(input.date)}`));
  if (input.driverName?.trim()) lines.push(textOrRaster(`Chauffeur : ${input.driverName.trim()}`));
  if (input.truckLabel?.trim()) lines.push(textOrRaster(`Camion : ${input.truckLabel.trim()}`));
  lines.push({ kind: "text", text: RULE_A, font: "A" });

  // Columns (dots): RECHARGE ends at the paper edge, CHARGE ends one gap before it,
  // PRODUIT starts at the left margin. Wide numbers widen their column, never lose digits.
  const digits = (value: number) => String(value).length;
  const reloadCol = Math.max("RECHARGE".length * CHAR_DOTS_B, ...input.lines.map((l) => digits(l.reloadedQuantity) * CHAR_DOTS_A));
  const chargeCol = Math.max("CHARGE".length * CHAR_DOTS_B, ...input.lines.map((l) => digits(l.initialQuantity) * CHAR_DOTS_A));
  const reloadEdge = PRINTABLE_DOTS;
  const chargeEdge = reloadEdge - reloadCol - COLUMN_GAP_DOTS;
  const nameW = Math.max(8, Math.min(COLUMNS_FONT_A, Math.floor((chargeEdge - chargeCol - CHAR_DOTS_A) / CHAR_DOTS_A)));
  const nameMaxDots = nameW * CHAR_DOTS_A;

  lines.push(
    columnsLine(
      "B",
      [
        { x: 0, text: "PRODUIT" },
        { x: chargeEdge - "CHARGE".length * CHAR_DOTS_B, text: "CHARGE" },
        { x: reloadEdge - "RECHARGE".length * CHAR_DOTS_B, text: "RECHARGE" },
      ],
      { bold: true },
    ),
  );
  lines.push({ kind: "text", text: RULE_A, font: "A" });

  for (const line of input.lines) {
    const charge = String(line.initialQuantity);
    const reload = String(line.reloadedQuantity);
    const numberCells = [
      { x: chargeEdge - charge.length * CHAR_DOTS_A, text: charge },
      { x: reloadEdge - reload.length * CHAR_DOTS_A, text: reload },
    ];
    const name = printableText(line.productName, codePage);
    if (name.encodable) {
      wrap(name.text, nameW, 2).forEach((part, index) => {
        lines.push(columnsLine("A", index === 0 ? [{ x: 0, text: part }, ...numberCells] : [{ x: 0, text: part }], { codePage }));
      });
    } else {
      // Arabic / non-printable name: the whole row is ONE image, so the name is never
      // on a separate line from its quantities.
      lines.push({
        kind: "rasterCells",
        fontPx: 24,
        cells: [
          { text: normalizeSpaces(line.productName), at: 0, align: "left", maxWidth: nameMaxDots },
          { text: charge, at: chargeEdge, align: "right" },
          { text: reload, at: reloadEdge, align: "right" },
        ],
        fallback: [{ x: 0, text: "(non imprimable)".slice(0, nameW) }, ...numberCells],
      });
    }
  }

  lines.push({ kind: "text", text: RULE_A, font: "A" });
  lines.push({ kind: "feed", lines: 4 });
  return lines;
}

export function buildLoadingEscPos(
  input: LoadingTicketInput,
  options: { raster?: RasterRenderer; rasterCells?: RasterCellsRenderer; codePage?: CodePageName } = {},
): EncodeResult {
  return encodeReceipt(buildLoadingReceiptLines(input, options), options.raster, options.rasterCells);
}
