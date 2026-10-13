import assert from "node:assert/strict";
import { test } from "node:test";

import { computePriceTTC } from "@/lib/product-pricing";

import {
  buildLoadingEscPos,
  buildLoadingReceiptLines,
  type LoadingTicketInput,
} from "./escpos-loading";
import { COLUMNS_FONT_A, type RasterCellsRenderer, type ReceiptLine } from "./escpos-receipt";
import { printLoadingTicketWith } from "./thermal-loading-print";
import {
  createThermalPrinterService,
  type ThermalPrinterPlugin,
  type ThermalPrinterStatus,
  type ThermalPrinterStorage,
} from "./thermal-printer";

type TextLine = Extract<ReceiptLine, { kind: "text" }>;
const textLines = (lines: ReceiptLine[]) => lines.filter((l): l is TextLine => l.kind === "text");
const allText = (lines: ReceiptLine[]) =>
  lines.map((l) => (l.kind === "feed" ? "" : l.kind === "rasterCells" ? l.cells.map((c) => c.text).join(" ") : l.text)).join("\n");

const input: LoadingTicketInput = {
  date: "2026-09-26",
  driverName: "Ahmed Chauffeur",
  truckLabel: "CAM-01 - 12345-A-1",
  lines: [
    { productName: "Produit 1", initialQuantity: 100, reloadedQuantity: 30, theoreticalQuantity: 125, actualQuantity: 120 },
    { productName: "Produit 2", initialQuantity: 0, reloadedQuantity: 0, theoreticalQuantity: 0, actualQuantity: 0 },
    { productName: "Produit 3", initialQuantity: 50, reloadedQuantity: 0, theoreticalQuantity: 40, actualQuantity: null },
    { productName: "Produit 4", initialQuantity: 10, reloadedQuantity: 5, theoreticalQuantity: 12, actualQuantity: 15 },
  ],
};

function hasSequence(bytes: Uint8Array, sequence: number[]): boolean {
  outer: for (let i = 0; i <= bytes.length - sequence.length; i += 1) {
    for (let j = 0; j < sequence.length; j += 1) if (bytes[i + j] !== sequence[j]) continue outer;
    return true;
  }
  return false;
}

const isSeparator = (cell: { text: string }) => cell.text === "¦";

/** Product rows (font A, name + 5 separators + 5 quantities): [name, charge, recharge, theorique, reel, decalage]. */
function rows(lines: ReceiptLine[]) {
  return textLines(lines)
    .filter((t) => t.font === "A" && t.cells && t.cells.length === 11)
    .map((t) => t.cells!.filter((c) => !isSeparator(c)).map((c) => c.text));
}

test("ticket content: brand, title, date, driver, truck, the 6 columns and the counted products", () => {
  const lines = buildLoadingReceiptLines(input);
  const text = allText(lines);
  for (const expected of ["AITSALAH STORE", "TRANSFERT DE STOCK", "Date : 26/09/2026", "Chauffeur : Ahmed Chauffeur", "Camion : CAM-01 - 12345-A-1", "PRODUIT", "CHARGE", "INIT.", "RECH.", "THÉO.", "RÉEL", "DÉCAL."]) {
    assert.ok(text.includes(expected), expected);
  }
  assert.deepEqual(rows(lines), [
    ["Produit 1", "100", "30", "125", "120", "-5"],
    ["Produit 2", "0", "0", "0", "0", "0"],
    ["Produit 3", "50", "0", "40", "-", "-"],
    ["Produit 4", "10", "5", "12", "15", "+3"],
  ]);
  assert.ok(text.includes("Produits comptés : 3 / 4"));
  assert.ok(text.includes("Décalage = restant réel - restant théorique"));
  for (const forbidden of ["DEPOT", "Prix"]) assert.equal(text.toUpperCase().includes(forbidden.toUpperCase()), false, forbidden);
});

test("an older caller without theoretical / real figures prints dashes, never a made-up 0 or gap", () => {
  const lines = buildLoadingReceiptLines({ ...input, lines: [{ productName: "Eau", initialQuantity: 12, reloadedQuantity: 3 }] });
  assert.deepEqual(rows(lines), [["Eau", "12", "3", "-", "-", "-"]]);
  assert.ok(allText(lines).includes("Produits comptés : 0 / 1"));
});

test("driver and truck lines are optional", () => {
  const text = allText(buildLoadingReceiptLines({ ...input, driverName: null, truckLabel: undefined }));
  assert.equal(text.includes("Chauffeur"), false);
  assert.equal(text.includes("Camion"), false);
  assert.ok(text.includes("Date : 26/09/2026"));
});

test("layout: dashed vertical separators at the same place on every line, values right-aligned under their titles, a dashed rule under each product", () => {
  const wide: LoadingTicketInput = { ...input, lines: [{ productName: "Eau", initialQuantity: 123456, reloadedQuantity: 9876543, theoreticalQuantity: -40, actualQuantity: 1000000 }] };
  for (const sample of [input, wide]) {
    const lines = buildLoadingReceiptLines(sample);
    const texts = textLines(lines);
    const titles = texts.filter((t) => t.font === "B" && t.cells && t.cells.some(isSeparator));
    assert.equal(titles.length, 2, "two title lines");
    const separatorXs = (t: TextLine) => t.cells!.filter(isSeparator).map((c) => c.x);
    const reference = separatorXs(titles[0]);
    assert.equal(reference.length, 5, "one separator before each of the 5 quantity columns");
    assert.deepEqual(separatorXs(titles[1]), reference);
    assert.equal(titles[1].cells![0].text, "PRODUIT");
    assert.equal(titles[1].cells![0].x, 0);
    const titleRight = titles[1].cells!.filter((c) => !isSeparator(c) && c.text !== "PRODUIT").map((c) => c.x + c.text.length * 9);
    assert.equal(titleRight.at(-1), 576, "DÉCAL. ends at the paper edge");
    const productRows = texts.filter((t) => t.font === "A" && t.cells && t.cells.length === 11);
    assert.equal(productRows.length, sample.lines.length);
    for (const row of productRows) {
      assert.deepEqual(separatorXs(row), reference, "separators aligned with the titles");
      const values = row.cells!.filter((c) => !isSeparator(c)).slice(1);
      values.forEach((value, column) => assert.equal(value.x + value.text.length * 12, titleRight[column], "value ends where its title ends"));
      const name = row.cells![0];
      assert.equal(name.x, 0);
      assert.ok(name.x + name.text.length * 12 <= reference[0], "the name never reaches the first separator");
      // a dashed rule right after the product (after its wrapped second line if any)
      const index = lines.indexOf(row);
      const next = lines[index + 1] as TextLine;
      const rule = /^-+$/.test(next.text) ? next : (lines[index + 2] as TextLine);
      assert.match(rule.text, /^-+$/);
    }
    for (const t of texts) assert.ok(t.text.length <= (COLUMNS_FONT_A * 4) / 3, t.text);
  }
  // wide numbers widen their column, never lose digits
  assert.deepEqual(rows(buildLoadingReceiptLines(wide)), [["Eau", "123456", "9876543", "-40", "1000000", "+1000040"]]);
});

test("a long name wraps on 2 lines with the quantities on the first one, separators on both; accents are native text", () => {
  const lines = buildLoadingReceiptLines({
    ...input,
    lines: [{ productName: "Eau minérale gazeuse naturelle en bouteille 1,5L pack économique", initialQuantity: 12, reloadedQuantity: 3, theoreticalQuantity: 15, actualQuantity: 15 }],
  });
  const texts = textLines(lines);
  const first = texts.find((t) => t.cells && t.cells.length === 11 && t.font === "A")!;
  assert.match(first.cells![0].text, /^Eau minérale/);
  const second = texts[texts.indexOf(first) + 1];
  assert.equal(second.cells!.length, 6, "name + the 5 separators, no quantity");
  assert.equal(second.cells![0].x, 0);
  assert.equal(lines.filter((l) => l.kind === "raster" || l.kind === "rasterCells").length, 0);
});

const fakeCells: RasterCellsRenderer = (_cells, { widthDots }) => ({ width: widthDots, height: 36, data: new Uint8Array(Math.ceil(widthDots / 8) * 36).fill(1) });

test("an Arabic product name: its WHOLE row is one image line (name never separated from its quantities)", () => {
  const sample: LoadingTicketInput = {
    ...input,
    lines: [
      { productName: "مشروب غازي", initialQuantity: 10, reloadedQuantity: 5, theoreticalQuantity: 9, actualQuantity: 7 },
      { productName: "Coca", initialQuantity: 1, reloadedQuantity: 2, theoreticalQuantity: 3, actualQuantity: null },
    ],
  };
  const lines = buildLoadingReceiptLines(sample);
  const arabic = lines.filter((l) => l.kind === "rasterCells");
  assert.equal(arabic.length, 1);
  assert.equal(lines.filter((l) => l.kind === "raster").length, 0);
  const cells = (arabic[0] as Extract<ReceiptLine, { kind: "rasterCells" }>).cells;
  assert.deepEqual(
    cells.filter((c) => !isSeparator(c)).map((c) => [c.text, c.align]),
    [["مشروب غازي", "left"], ["10", "right"], ["5", "right"], ["9", "right"], ["7", "right"], ["-2", "right"]],
  );
  assert.equal(cells.filter(isSeparator).length, 5);
  assert.equal(cells[0].at, 0);
  assert.equal(cells.at(-1)!.at, 576);
  const encoded = buildLoadingEscPos(sample, { rasterCells: fakeCells });
  assert.equal(encoded.rasterLines, 1);
  assert.ok(hasSequence(encoded.bytes, [0x1d, 0x76, 0x30, 0x00]));
  // without an image renderer the row still prints on ONE line with a marker
  const plain = buildLoadingEscPos(sample);
  assert.deepEqual(plain.unrenderedLines, ["مشروب غازي"]);
  const asText = Buffer.from(plain.bytes).toString("latin1");
  assert.ok(asText.includes("(non imprimable)") && asText.includes("10") && asText.includes("Coca"));
});

test("ESC/POS stream: init, motion unit, code page, fonts, ESC $ columns, the dashed separator character, cut", () => {
  const { bytes } = buildLoadingEscPos(input);
  assert.deepEqual([bytes[0], bytes[1]], [0x1b, 0x40]);
  assert.ok(hasSequence(bytes, [0x1d, 0x50, 203, 203]));
  assert.ok(hasSequence(bytes, [0x1b, 0x74, 19]));
  assert.ok(hasSequence(bytes, [0x1b, 0x4d, 0x01]), "font B titles");
  assert.ok(hasSequence(bytes, [0x1b, 0x24, 0, 0]), "ESC $ 0 0 : PRODUIT / names at the left margin");
  assert.ok(bytes.includes(0xdd), "¦ printed natively (cp858 0xDD)");
  assert.deepEqual(Array.from(bytes.slice(-4)), [0x1d, 0x56, 0x42, 0x00]);
});

// ---------------------------------------------------------------------------
// Printing goes through the EXISTING Bluetooth service (plugin, selected printer, errors)
// ---------------------------------------------------------------------------

const PRINTER = { name: "POS-8003-19DB", address: "AA:BB:CC:DD:EE:FF" };

function memoryStorage(): ThermalPrinterStorage {
  const data = new Map<string, string>();
  return { get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v), remove: async (k) => void data.delete(k) };
}

function fakePlugin(status: Partial<ThermalPrinterStatus> = {}) {
  const calls: Array<{ address: string; data: string }> = [];
  const plugin: ThermalPrinterPlugin = {
    async getStatus() {
      return { bluetoothSupported: true, bluetoothEnabled: true, permissionGranted: true, sdkInt: 34, connectedAddress: null, ...status };
    },
    async requestBluetoothPermission() {
      return { granted: true };
    },
    async listPairedPrinters() {
      return { printers: [PRINTER], connectedAddress: null };
    },
    async connect() {
      return { connected: true };
    },
    async disconnect() {},
    async print(options) {
      calls.push(options);
      return { bytesWritten: 1 };
    },
    async openBluetoothSettings() {},
  };
  return { plugin, calls };
}

test("printing the loading uses the Bluetooth plugin's print() with the selected printer, no network", async () => {
  const storage = memoryStorage();
  const { plugin, calls } = fakePlugin();
  const service = createThermalPrinterService({ plugin, storage });
  await service.selectPrinter(PRINTER);

  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("network must not be used to print");
  }) as typeof fetch;
  try {
    const result = await printLoadingTicketWith(service, input);
    assert.equal(result.ok, true);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].address, PRINTER.address);
  const bytes = Buffer.from(calls[0].data, "base64");
  assert.ok(bytes.includes(Buffer.from("TRANSFERT DE STOCK")));
  assert.ok(bytes.includes(Buffer.from("Produit 1")));
});

test("no printer / permission / Bluetooth off: same error codes as the invoice printing (the UI then asks or falls back)", async () => {
  const noPrinter = createThermalPrinterService({ plugin: fakePlugin().plugin, storage: memoryStorage() });
  const first = await printLoadingTicketWith(noPrinter, input);
  assert.equal(first.ok === false && first.code, "NO_PRINTER");

  for (const [status, code] of [
    [{ permissionGranted: false }, "PERMISSION_REQUIRED"],
    [{ bluetoothEnabled: false }, "BLUETOOTH_OFF"],
  ] as const) {
    const { plugin, calls } = fakePlugin(status);
    const service = createThermalPrinterService({ plugin, storage: memoryStorage() });
    await service.selectPrinter(PRINTER);
    const result = await printLoadingTicketWith(service, input);
    assert.equal(result.ok === false && result.code, code);
    assert.equal(calls.length, 0);
  }
});

test("the loading price data used by the table is the product's real TTC price (HT x (1 + VAT)), untouched", () => {
  assert.equal(computePriceTTC(33.33, 20), 40);
  assert.equal(computePriceTTC(20, 0), 20);
  assert.equal(computePriceTTC(10, 10), 11);
});
