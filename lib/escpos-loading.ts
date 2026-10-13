/**
 * ESC/POS ticket of a truck LOADING ("transfert de stock"), for the same
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
 * Layout (font A values 12x24 dots, font B titles 9x17 dots, 576 dots):
 *                   ¦CHARGE¦     ¦REST.¦REST.¦
 *   PRODUIT         ¦INIT. ¦RECH.¦THÉO.¦RÉEL ¦DÉCAL.
 *   ------------------------------------------------
 *   Produit 1       ¦   100¦   30¦  125¦  120¦    -5
 *   ------------------------------------------------
 * Vertical dashed separators ("¦") between the columns, a dashed rule between
 * the products, quantities right-aligned under their titles. Decalage = restant
 * reel - restant theorique, signed (+ surplus, - manque); "-" when the product
 * was not counted. The footer gives the number of products counted.
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
import { countedSummary, formatGap, formatQuantityOrDash, remainingGap } from "@/lib/truck-loading-remaining";

export type LoadingTicketLine = {
  productName: string;
  initialQuantity: number;
  reloadedQuantity: number;
  /** Restant theorique; null / omitted = unknown (printed "-"). */
  theoreticalQuantity?: number | null;
  /** Restant reel counted; null / omitted = not counted (printed "-", no decalage). */
  actualQuantity?: number | null;
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
/** The vertical dashed separator (cp858 0xDD), printed in font A. */
const SEPARATOR = "¦";
/** Space between a separator and the column next to it, in dots. */
const SEPARATOR_PAD = 3;
const DASH = "-";

/** Titles of the 5 quantity columns, on up to 2 lines (font B). */
export const LOADING_TICKET_TITLES: ReadonlyArray<readonly [string, string]> = [
  ["CHARGE", "INIT."],
  ["", "RECH."],
  ["REST.", "THÉO."],
  ["REST.", "RÉEL"],
  ["", "DÉCAL."],
];

function formatLoadingDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

/** The 5 printed quantities of a line: charge, recharge, theorique, reel, decalage. */
export function loadingTicketCells(line: LoadingTicketLine): [string, string, string, string, string] {
  const theoretical = line.theoreticalQuantity ?? null;
  const actual = line.actualQuantity ?? null;
  return [
    String(line.initialQuantity),
    String(line.reloadedQuantity),
    formatQuantityOrDash(theoretical, DASH),
    formatQuantityOrDash(actual, DASH),
    formatGap(remainingGap(actual, theoretical), DASH),
  ];
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
  lines.push({ kind: "text", text: "TRANSFERT DE STOCK", font: "A", bold: true, tall: true, align: "center", codePage });
  lines.push({ kind: "text", text: RULE_A, font: "A" });
  lines.push(textOrRaster(`Date : ${formatLoadingDate(input.date)}`));
  if (input.driverName?.trim()) lines.push(textOrRaster(`Chauffeur : ${input.driverName.trim()}`));
  if (input.truckLabel?.trim()) lines.push(textOrRaster(`Camion : ${input.truckLabel.trim()}`));
  lines.push({ kind: "text", text: RULE_A, font: "A" });

  // Columns (dots), built from the right paper edge: each quantity column is as
  // wide as its title or its widest value (wide numbers widen their column,
  // never lose digits), preceded by a separator; the product name gets the rest.
  const cellsByLine = input.lines.map(loadingTicketCells);
  const widths = LOADING_TICKET_TITLES.map((title, column) =>
    Math.max(
      Math.max(title[0].length, title[1].length) * CHAR_DOTS_B,
      ...cellsByLine.map((cells) => cells[column].length * CHAR_DOTS_A),
    ),
  );
  const rightEdges: number[] = new Array(widths.length);
  const separatorX: number[] = new Array(widths.length);
  let edge = PRINTABLE_DOTS;
  for (let column = widths.length - 1; column >= 0; column -= 1) {
    rightEdges[column] = edge;
    separatorX[column] = edge - widths[column] - SEPARATOR_PAD - CHAR_DOTS_A;
    edge = separatorX[column] - SEPARATOR_PAD;
  }
  const nameEdge = edge;
  const nameW = Math.max(6, Math.min(COLUMNS_FONT_A, Math.floor(nameEdge / CHAR_DOTS_A)));
  const separators = separatorX.map((x) => ({ x, text: SEPARATOR }));
  const rightAligned = (font: "A" | "B", texts: readonly string[]) =>
    texts.map((text, column) => ({ x: rightEdges[column] - text.length * (font === "A" ? CHAR_DOTS_A : CHAR_DOTS_B), text }));

  // Titles: two font-B lines, "PRODUIT" on the second; separators on both so the
  // dashed verticals start at the title.
  lines.push(columnsLine("B", [...separators, ...rightAligned("B", LOADING_TICKET_TITLES.map((title) => title[0]))], { bold: true, codePage }));
  lines.push(
    columnsLine("B", [{ x: 0, text: "PRODUIT" }, ...separators, ...rightAligned("B", LOADING_TICKET_TITLES.map((title) => title[1]))], {
      bold: true,
      codePage,
    }),
  );
  lines.push({ kind: "text", text: RULE_A, font: "A" });

  input.lines.forEach((line, index) => {
    const numberCells = rightAligned("A", cellsByLine[index]);
    const name = printableText(line.productName, codePage);
    if (name.encodable) {
      const parts = wrap(name.text, nameW, 2);
      parts.forEach((part, partIndex) => {
        lines.push(
          columnsLine("A", partIndex === 0 ? [{ x: 0, text: part }, ...separators, ...numberCells] : [{ x: 0, text: part }, ...separators], {
            codePage,
          }),
        );
      });
    } else {
      // Arabic / non-printable name: the whole row is ONE image, so the name is never
      // on a separate line from its quantities.
      lines.push({
        kind: "rasterCells",
        fontPx: 24,
        cells: [
          { text: normalizeSpaces(line.productName), at: 0, align: "left", maxWidth: nameEdge },
          ...separatorX.map((x) => ({ text: SEPARATOR, at: x, align: "left" as const })),
          ...cellsByLine[index].map((text, column) => ({ text, at: rightEdges[column], align: "right" as const })),
        ],
        fallback: [{ x: 0, text: "(non imprimable)".slice(0, nameW) }, ...separators, ...numberCells],
      });
    }
    // dashed rule between the products (and under the last one)
    lines.push({ kind: "text", text: RULE_A, font: "A" });
  });

  const { counted, total } = countedSummary(input.lines.map((line) => ({ actualRemainingQuantity: line.actualQuantity ?? null })));
  lines.push(textOrRaster(`Produits comptés : ${counted} / ${total}`));
  lines.push({ kind: "text", text: "Décalage = restant réel - restant théorique", font: "B", align: "left", codePage });
  lines.push({ kind: "feed", lines: 4 });
  return lines;
}

export function buildLoadingEscPos(
  input: LoadingTicketInput,
  options: { raster?: RasterRenderer; rasterCells?: RasterCellsRenderer; codePage?: CodePageName } = {},
): EncodeResult {
  return encodeReceipt(buildLoadingReceiptLines(input, options), options.raster, options.rasterCells);
}
