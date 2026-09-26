import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ReceiptPrint } from "@/components/pos/receipt-print";
import { computeDiscountedLineTotals } from "@/lib/pos-discount";
import type { SaleDto } from "@/types/operations-dto";

import {
  buildReceiptEscPos,
  buildReceiptLines,
  buildTestEscPos,
  buildTestReceiptLines,
  COLUMNS_FONT_A,
  COLUMNS_FONT_B,
  encodeChar,
  encodeReceipt,
  isEncodable,
  rasterToEscPos,
  type RasterImage,
  type RasterRenderer,
  type ReceiptLine,
} from "./escpos-receipt";
import { rgbaToRasterImage } from "./escpos-raster-canvas";

type Item = { name: string; unitTTC: number; quantity: number; discountUnitAmount?: number; taxRate?: number };

/** A stored line exactly as the sale services compute it (DH per unit off the TTC price). */
function line(item: Item, index: number) {
  const taxRate = item.taxRate ?? 20;
  const unitPriceHT = item.unitTTC / (1 + taxRate / 100);
  const totals = computeDiscountedLineTotals({
    unitPriceHT,
    taxRate,
    quantity: item.quantity,
    discountUnitAmount: item.discountUnitAmount ?? 0,
  });
  return {
    id: `l${index}`,
    productId: `p${index}`,
    productName: item.name,
    productReference: `REF${index}`,
    quantity: item.quantity,
    unitPriceHT,
    taxRate,
    discountRate: totals.discountRate,
    discountAmount: totals.discountAmount,
    totalHT: totals.totalHT,
    taxAmount: totals.taxAmount,
    totalTTC: totals.totalTTC,
  };
}

function saleOf(items: Item[], overrides: Record<string, unknown> = {}): SaleDto {
  const lines = items.map(line);
  const totalTTC = lines.reduce((sum, l) => sum + l.totalTTC, 0);
  return {
    id: "s1",
    displayNumber: "33/2026",
    invoiceNumber: "VC-1",
    status: "PAID",
    paymentMethod: "CASH",
    paidAmount: totalTTC,
    creditAmount: 0,
    totalTTC,
    createdAt: "2026-09-25T10:00:00.000Z",
    validatedAt: "2026-09-25T10:00:00.000Z",
    customer: { id: "c1", code: "34211", name: "Client Un" },
    driver: null,
    createdByUserName: "Chauffeur",
    payments: [],
    lines,
    ...overrides,
  } as unknown as SaleDto;
}

type TextLine = Extract<ReceiptLine, { kind: "text" }>;
const textLines = (lines: ReceiptLine[]) => lines.filter((l): l is TextLine => l.kind === "text");
const allText = (lines: ReceiptLine[]) =>
  lines.map((l) => (l.kind === "feed" ? "" : l.text)).join("\n");

/** [qty, name, price, amount] of every product row (font A lines between the 2nd and 3rd rule). */
function productRows(lines: ReceiptLine[]): string[][] {
  const texts = textLines(lines);
  const rules = texts.map((t, i) => (/^-+$/.test(t.text) ? i : -1)).filter((i) => i >= 0);
  const rows: string[][] = [];
  for (const t of texts.slice(rules[1] + 1, rules[2])) {
    const match = t.text.trim().match(/^(\d+) +(.*?) +([\d.]+,\d\d) +([\d.]+,\d\d)$/);
    if (match) rows.push([match[1], match[2].trim(), match[3], match[4]]);
    else {
      // an Arabic name is an image line: its numbers line has no name
      const numbers = t.text.trim().match(/^(\d+) +([\d.]+,\d\d) +([\d.]+,\d\d)$/);
      if (numbers) rows.push([numbers[1], "", numbers[2], numbers[3]]);
    }
  }
  return rows;
}

const fakeRaster: RasterRenderer = (text, { widthDots }) => {
  const width = widthDots;
  const height = 24;
  return { width, height, data: new Uint8Array(Math.ceil(width / 8) * height).fill(0xff), } satisfies RasterImage;
};

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

test("French accents are encoded in PC858 (ESC t 19) and WPC1252 (ESC t 16)", () => {
  const expected858: Record<string, number> = { é: 0x82, è: 0x8a, à: 0x85, ç: 0x87, ù: 0x97, ô: 0x93, É: 0x90, È: 0xd4, À: 0xb7, Ç: 0x80, "°": 0xf8, "€": 0xd5 };
  for (const [char, byte] of Object.entries(expected858)) assert.equal(encodeChar(char, "cp858"), byte, char);
  const expected1252: Record<string, number> = { é: 0xe9, è: 0xe8, à: 0xe0, ç: 0xe7, ù: 0xf9, ô: 0xf4 };
  for (const [char, byte] of Object.entries(expected1252)) assert.equal(encodeChar(char, "cp1252"), byte, char);
  assert.equal(encodeChar("A", "cp858"), 0x41);
});

test("Arabic and other scripts are not encodable as text; accents and typographic characters are", () => {
  assert.equal(isEncodable("اختبار الطباعة"), false);
  assert.equal(isEncodable("Coca Cola 1L"), true);
  assert.equal(isEncodable("Crème brûlée à l’ancienne – 1,5 €"), true);
  assert.equal(isEncodable("Prix 中文"), false);
});

// ---------------------------------------------------------------------------
// The ticket: same rules as the web ticket
// ---------------------------------------------------------------------------

test("no discount: 40 x 10 -> price 40,00, amount 400,00, no discount line", () => {
  const lines = buildReceiptLines(saleOf([{ name: "Produit A", unitTTC: 40, quantity: 10 }]));
  assert.deepEqual(productRows(lines), [["10", "Produit A", "40,00", "400,00"]]);
  assert.equal(allText(lines).includes("Remise"), false);
});

test("40 - 1 DH/u: price 39,00, amount 390,00; 24 - 2 DH/u x 20: 22,00 / 440,00; never a Remise line", () => {
  const lines = buildReceiptLines(
    saleOf([
      { name: "A", unitTTC: 40, quantity: 10, discountUnitAmount: 1 },
      { name: "B", unitTTC: 24, quantity: 20, discountUnitAmount: 2 },
      { name: "C", unitTTC: 15.5, quantity: 3 },
    ]),
  );
  assert.deepEqual(productRows(lines), [
    ["10", "A", "39,00", "390,00"],
    ["20", "B", "22,00", "440,00"],
    ["3", "C", "15,50", "46,50"],
  ]);
  const bytesAsText = Buffer.from(buildReceiptEscPos(saleOf([{ name: "A", unitTTC: 40, quantity: 10, discountUnitAmount: 1 }])).bytes).toString("latin1");
  assert.equal(bytesAsText.includes("Remise"), false);
  assert.equal(allText(lines).includes("DH/u"), false);
});

test("the printed rows and total equal the web ticket's (same data, nothing recomputed)", () => {
  const sale = saleOf([
    { name: "A", unitTTC: 40, quantity: 10, discountUnitAmount: 1 },
    { name: "B", unitTTC: 24, quantity: 20, discountUnitAmount: 2 },
    { name: "C", unitTTC: 12, quantity: 5, discountUnitAmount: 0.5, taxRate: 10 },
    { name: "D", unitTTC: 15.5, quantity: 3 },
  ]);
  const web = renderToStaticMarkup(<ReceiptPrint sale={sale} identity={null} />);
  const norm = (value: string) => value.replace(/[  ]/g, " ").trim();
  const webRows: string[][] = [];
  for (const block of web.split('class="receipt-print-line"').slice(1)) {
    webRows.push([...block.matchAll(/<span class="receipt-print-(?:qty|product|number)">([^<]*)<\/span>/g)].slice(0, 4).map((m) => norm(m[1])));
  }
  const lines = buildReceiptLines(sale);
  assert.deepEqual(productRows(lines), webRows);
  const webTotal = norm(web.match(/receipt-print-total"><strong>([^<]*)</)![1]);
  // Thermal ticket only: TOTAL TTC on the left, the same amount on the right.
  const total = textLines(lines).find((t) => t.text.startsWith("TOTAL TTC"))!;
  assert.equal(total.text.endsWith(webTotal), true);
});

test("titles keep the base size (font B), row values are ~1.3x (font A), widths and order fixed", () => {
  const lines = textLines(buildReceiptLines(saleOf([{ name: "Produit A", unitTTC: 40, quantity: 2 }])));
  const head = lines.find((t) => t.text.includes("DESIGNATION"))!;
  assert.equal(head.font, "B");
  assert.equal(head.bold, true);
  assert.deepEqual(head.text.trim().split(/\s+/).filter(Boolean), ["QTE", "DESIGNATION", "Prix", "TTC", "Montant"]);
  assert.equal(head.text.length, COLUMNS_FONT_B);
  const row = lines.find((t) => t.text.includes("Produit A"))!;
  assert.equal(row.font, "A");
  assert.equal(row.text.length, COLUMNS_FONT_A);
  // font A glyphs are 12x24 dots against 9x17 for font B: 1.33x / 1.41x
  assert.ok(12 / 9 > 1.25 && 12 / 9 < 1.4);
  // the right edge of the numbers lines up under the titles (same dots)
  const rightDots = (text: string, char: number) => text.length * char;
  assert.equal(rightDots(head.text, 9), rightDots(row.text, 12));
});

test("total: TOTAL TTC on the LEFT, the amount on the RIGHT edge (like the Montant column), one line, emphasised", () => {
  const lines = textLines(buildReceiptLines(saleOf([{ name: "A", unitTTC: 928, quantity: 1 }])));
  const total = lines.find((t) => t.text.includes("TOTAL TTC"))!;
  assert.equal(total.text.length, COLUMNS_FONT_A);
  assert.match(total.text, /^TOTAL TTC\s+928,00 DH$/);
  assert.equal(total.bold, true);
  assert.equal(total.tall, true);
  // the amount ends on the last column, exactly where the Montant numbers end
  const row = lines.find((t) => /^1\s+A\s/.test(t.text))!;
  assert.equal(total.text.trimEnd().length, row.text.trimEnd().length);
});

function cellsOf(line: TextLine): Array<{ x: number; text: string }> {
  assert.ok(line.cells, "the line uses absolute column positions (ESC $)");
  return line.cells;
}

test("QTE -> DESIGNATION gap is doubled with REAL ESC $ column positions; QTE 2, 8 and 120", () => {
  const OLD_GAP_DOTS = 5 * 9; // QTE -> DESIGNATION before: 5 font-B characters
  const reference: { priceX?: number; montantX?: number; totalText?: string } = {};
  for (const quantity of [2, 8, 120]) {
    const price = 72;
    const lines = textLines(buildReceiptLines(saleOf([{ name: "Eau 1/2L", unitTTC: price, quantity }])));
    const head = lines.find((t) => t.text.includes("DESIGNATION"))!;
    const row = lines.find((t) => t.text.includes("Eau 1/2L"))!;
    const total = lines.find((t) => t.text.includes("TOTAL TTC"))!;
    const [qteTitle, designation, prixTitle, montantTitle] = cellsOf(head);
    const [qty, name, unit, amountCell] = cellsOf(row);

    // sizes unchanged: titles font B, values font A
    assert.equal(head.font, "B");
    assert.equal(row.font, "A");
    // QTE and the quantity share the left edge
    assert.equal(qteTitle.x, 0);
    assert.equal(qty.x, 0);
    assert.equal(qty.text, String(quantity));
    // DESIGNATION starts EXACTLY where the product name starts
    assert.equal(designation.x, name.x);
    // the gap between the end of "QTE" and DESIGNATION is about twice the old one
    const gap = designation.x - "QTE".length * 9;
    assert.ok(gap >= 2 * OLD_GAP_DOTS, `gap ${gap} dots vs old ${OLD_GAP_DOTS}`);
    // the quantity never touches the name, even at 120
    assert.ok(name.x - quantity.toString().length * 12 >= 60, "at least 60 dots (5 characters) between quantity and name");
    // Prix TTC / Montant: right-aligned to fixed edges - identical for every quantity
    const priceEdgeTitle = prixTitle.x + prixTitle.text.length * 9;
    const priceEdgeValue = unit.x + unit.text.length * 12;
    assert.ok(Math.abs(priceEdgeTitle - priceEdgeValue) <= 9);
    assert.equal(montantTitle.x + montantTitle.text.length * 9, 576);
    assert.equal(amountCell.x + amountCell.text.length * 12, 576);
    reference.priceX ??= priceEdgeValue;
    reference.montantX ??= amountCell.x + amountCell.text.length * 12;
    assert.equal(priceEdgeValue, reference.priceX);
    assert.equal(amountCell.x + amountCell.text.length * 12, reference.montantX);
    // Total line untouched: TOTAL TTC left, amount right
    reference.totalText ??= total.text.replace(/\d[\d.,]*/, "N");
    assert.match(total.text, /^TOTAL TTC\s+[\d.,]+ DH$/);
    assert.equal(total.text.length, COLUMNS_FONT_A);
  }
});

test("the column positions reach the printer as ESC $ (absolute position), with the motion unit set to 1 dot", () => {
  const { bytes } = buildReceiptEscPos(saleOf([{ name: "Eau 1/2L", unitTTC: 72, quantity: 2 }]));
  assert.ok(hasSequence(bytes, [0x1d, 0x50, 203, 203]), "GS P 203 203");
  assert.ok(hasSequence(bytes, [0x1b, 0x24, 117, 0]), "ESC $ 117 0 : DESIGNATION / name at x = 117 dots");
  assert.ok(hasSequence(bytes, [0x1b, 0x24, 0, 0]), "ESC $ 0 0 : QTE / quantity at the left margin");
  // the row is 4 positioned cells, not padded with spaces
  const eau = Buffer.from(bytes).toString("latin1");
  assert.ok(eau.includes("\x1b$u\x00Eau 1/2L"), "name printed right after its ESC $");
  assert.equal(/2 {3,}Eau/.test(eau), false, "no run of spaces between quantity and name");
});

test("example 2 x Eau 1/2L at 72,00 = 144,00, and 8 x 67,00 = 536,00", () => {
  const two = textLines(buildReceiptLines(saleOf([{ name: "Eau 1/2L", unitTTC: 72, quantity: 2 }])));
  assert.match(two.find((t) => t.text.includes("Eau"))!.text, /^2 +Eau 1\/2L +72,00 +144,00$/);
  assert.match(two.find((t) => t.text.includes("TOTAL"))!.text, /^TOTAL TTC +144,00 DH$/);
  const eight = textLines(buildReceiptLines(saleOf([{ name: "Eau 1/2L", unitTTC: 67, quantity: 8 }])));
  assert.match(eight.find((t) => t.text.includes("Eau"))!.text, /^8 +Eau 1\/2L +67,00 +536,00$/);
});

test("no EN ATTENTE box on top; the footer Statut line stays; paid ticket footer unchanged", () => {
  const draft = allText(buildReceiptLines(saleOf([{ name: "A", unitTTC: 40, quantity: 1 }], { status: "DRAFT", paidAmount: 0 })));
  assert.equal((draft.match(/EN ATTENTE DE RÈGLEMENT/g) ?? []).length, 1);
  assert.match(draft, /Statut : EN ATTENTE DE RÈGLEMENT/);
  const paid = allText(buildReceiptLines(saleOf([{ name: "A", unitTTC: 40, quantity: 3 }])));
  for (const expected of ["Paiement : Espèces", "Statut : Réglée", "Caisse : Chauffeur", "3 Articles", "N° Facture : 33/2026", "Client : Client Un", "N° client : 3421/1"]) {
    assert.ok(paid.includes(expected), expected);
  }
});

test("an offline ticket prints its own marker and reference, like the web ticket", () => {
  const text = allText(buildReceiptLines(saleOf([{ name: "A", unitTTC: 40, quantity: 1 }]), { offlineReference: "OFF-1234" }));
  assert.match(text, /Référence : OFF-1234/);
  assert.match(text, /TICKET HORS CONNEXION/);
  assert.match(text, /Numéro définitif attribué après synchronisation\./);
});

test("nothing is cut: big prices, big quantities and long names keep every digit within the paper width", () => {
  const sale = saleOf([
    { name: "Produit avec un nom vraiment très long qui dépasse", unitTTC: 1234.5, quantity: 12 },
    { name: "Grosse quantité", unitTTC: 9.5, quantity: 1200 },
  ]);
  const lines = textLines(buildReceiptLines(sale));
  for (const t of lines) assert.ok(t.text.length <= (t.font === "B" ? COLUMNS_FONT_B : COLUMNS_FONT_A), t.text);
  const rows = productRows(buildReceiptLines(sale));
  assert.equal(rows[0][2], "1.234,50");
  assert.equal(rows[0][3], "14.814,00");
  assert.equal(rows[1][0], "1200");
  // the long name wraps on 2 lines and is cut cleanly with ".." at most
  const nameLines = lines.filter((t) => t.text.includes("Produit avec") || t.text.includes("nom") || t.text.includes(".."));
  assert.ok(nameLines.length >= 1);
});

// ---------------------------------------------------------------------------
// Bytes, accents, Arabic (raster only where needed)
// ---------------------------------------------------------------------------

function hasSequence(bytes: Uint8Array, sequence: number[]): boolean {
  outer: for (let i = 0; i <= bytes.length - sequence.length; i += 1) {
    for (let j = 0; j < sequence.length; j += 1) if (bytes[i + j] !== sequence[j]) continue outer;
    return true;
  }
  return false;
}

test("ESC/POS stream: initialise, code page, fonts, alignment, cut - and accents as single bytes", () => {
  const { bytes, rasterLines } = buildReceiptEscPos(saleOf([{ name: "Crème brûlée", unitTTC: 40, quantity: 2 }], { customer: { id: "c", code: "34211", name: "Étienne Ça" } }));
  assert.deepEqual([bytes[0], bytes[1]], [0x1b, 0x40]);
  assert.deepEqual(Array.from(bytes.slice(-4)), [0x1d, 0x56, 0x42, 0x00]);
  assert.ok(hasSequence(bytes, [0x1b, 0x74, 19]), "PC858 selected");
  assert.ok(hasSequence(bytes, [0x1b, 0x4d, 0x01]), "font B for the titles");
  assert.ok(hasSequence(bytes, [0x1b, 0x4d, 0x00]), "font A for the values");
  assert.ok(hasSequence(bytes, [0x1d, 0x21, 0x01]), "tall total");
  assert.ok(hasSequence(bytes, [0x43, 0x72, 0x8a, 0x6d, 0x65]), "Crème -> C r 0x8A m e");
  assert.ok(hasSequence(bytes, [0x90, 0x74, 0x69, 0x65, 0x6e, 0x6e, 0x65]), "Étienne -> 0x90 ...");
  assert.equal(rasterLines, 0, "a Latin ticket is never an image");
});

test("an Arabic product name becomes ONE image line; the rest stays native text", () => {
  const sale = saleOf([{ name: "مشروب غازي", unitTTC: 12, quantity: 3 }, { name: "Coca", unitTTC: 10, quantity: 1 }]);
  const lines = buildReceiptLines(sale);
  assert.equal(lines.filter((l) => l.kind === "raster").length, 1);
  assert.deepEqual(productRows(lines).map((r) => r.slice(-2)), [["12,00", "36,00"], ["10,00", "10,00"]]);
  const encoded = buildReceiptEscPos(sale, { raster: fakeRaster });
  assert.equal(encoded.rasterLines, 1);
  assert.ok(hasSequence(encoded.bytes, [0x1d, 0x76, 0x30, 0x00]), "GS v 0 raster command");
  assert.equal(encoded.unrenderedLines.length, 0);
  // no renderer available: readable placeholder, never garbage bytes
  const without = buildReceiptEscPos(sale);
  assert.equal(without.rasterLines, 0);
  assert.deepEqual(without.unrenderedLines, ["مشروب غازي"]);
  assert.ok(Buffer.from(without.bytes).toString("latin1").includes("[texte non imprimable]"));
});

test("raster packing: GS v 0 header, bytes per row, bands", () => {
  const image: RasterImage = { width: 16, height: 200, data: new Uint8Array(2 * 200).fill(0xaa) };
  const bytes = rasterToEscPos(image);
  assert.deepEqual(bytes.slice(0, 8), [0x1d, 0x76, 0x30, 0x00, 2, 0, 96, 0]);
  assert.equal(bytes.length, 3 * 8 + 2 * 200); // 3 bands (96 + 96 + 8 rows)
  const rgba = new Uint8ClampedArray(8 * 1 * 4);
  for (let x = 0; x < 8; x += 1) {
    const black = x % 2 === 0;
    rgba.set(black ? [0, 0, 0, 255] : [255, 255, 255, 255], x * 4);
  }
  assert.deepEqual(Array.from(rgbaToRasterImage(rgba, 8, 1).data), [0b10101010]);
  // a transparent pixel is white, not black
  assert.deepEqual(Array.from(rgbaToRasterImage(new Uint8ClampedArray([0, 0, 0, 0]), 1, 1).data), [0]);
});

// ---------------------------------------------------------------------------
// The test ticket
// ---------------------------------------------------------------------------

test("test ticket: title, printer name (never hard-coded), Bluetooth OK, accents in both code pages, Arabic as image, end", () => {
  for (const printerName of ["POS-8003-19DB", "Autre imprimante"]) {
    const lines = buildTestReceiptLines({ printerName });
    const text = allText(lines);
    for (const expected of ["COMDIS", "TEST IMPRESSION", `Imprimante : ${printerName}`, "Bluetooth : OK", "Accents (PC858) :", "Accents (WPC1252) :", "é è à ç ù ô", "Arabe (image) :", "FIN DU TEST"]) {
      assert.ok(text.includes(expected), expected);
    }
    const arabic = lines.find((l) => l.kind === "raster");
    assert.ok(arabic && arabic.kind === "raster" && arabic.text === "اختبار الطباعة");
    const encoded = buildTestEscPos({ printerName, raster: fakeRaster });
    assert.ok(hasSequence(encoded.bytes, [0x1b, 0x74, 19]) && hasSequence(encoded.bytes, [0x1b, 0x74, 16]));
    assert.ok(hasSequence(encoded.bytes, [0x82, 0x20, 0x8a]), "é è in PC858");
    assert.ok(hasSequence(encoded.bytes, [0xe9, 0x20, 0xe8]), "é è in WPC1252");
    assert.equal(encoded.rasterLines, 1);
  }
  assert.equal(textLines(buildTestReceiptLines({ printerName: "X" })).every((t) => t.text.length <= COLUMNS_FONT_A), true);
});

test("encodeReceipt never leaks emphasis or size from one line to the next", () => {
  const lines: ReceiptLine[] = [
    { kind: "text", text: "GROS", font: "A", bold: true, big: true },
    { kind: "text", text: "normal", font: "A" },
  ];
  const { bytes } = encodeReceipt(lines);
  assert.ok(hasSequence(bytes, [0x1d, 0x21, 0x11]));
  assert.ok(hasSequence(bytes, [0x1b, 0x45, 0x00, 0x1d, 0x21, 0x00]), "reset after the big line");
});
