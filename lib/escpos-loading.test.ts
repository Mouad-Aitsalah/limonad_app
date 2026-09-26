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
    { productName: "Produit 1", initialQuantity: 100, reloadedQuantity: 200 },
    { productName: "Produit 2", initialQuantity: 0, reloadedQuantity: 0 },
    { productName: "Produit 3", initialQuantity: 50, reloadedQuantity: 0 },
  ],
};

function hasSequence(bytes: Uint8Array, sequence: number[]): boolean {
  outer: for (let i = 0; i <= bytes.length - sequence.length; i += 1) {
    for (let j = 0; j < sequence.length; j += 1) if (bytes[i + j] !== sequence[j]) continue outer;
    return true;
  }
  return false;
}

/** [name, charge, recharge] of every product row. */
function rows(lines: ReceiptLine[]) {
  const texts = textLines(lines);
  const rules = texts.map((t, i) => (/^-+$/.test(t.text) ? i : -1)).filter((i) => i >= 0);
  const out: string[][] = [];
  for (const t of texts.slice(rules[2] + 1, rules[3])) {
    const match = t.text.trim().match(/^(.*?) +(\d+) +(\d+)$/);
    if (match) out.push([match[1], match[2], match[3]]);
  }
  return out;
}

test("ticket content: brand, CHARGEMENT, date, driver, truck, and the three products with CHARGE / RECHARGE only", () => {
  const lines = buildLoadingReceiptLines(input);
  const text = allText(lines);
  for (const expected of ["AITSALAH STORE", "CHARGEMENT", "Date : 26/09/2026", "Chauffeur : Ahmed Chauffeur", "Camion : CAM-01 - 12345-A-1", "PRODUIT", "CHARGE", "RECHARGE"]) {
    assert.ok(text.includes(expected), expected);
  }
  assert.deepEqual(rows(lines), [["Produit 1", "100", "200"], ["Produit 2", "0", "0"], ["Produit 3", "50", "0"]]);
  // nothing else is printed
  for (const forbidden of ["STOCK", "DEPOT", "THEORIQUE", "REELLE", "Prix"]) assert.equal(text.toUpperCase().includes(forbidden.toUpperCase()), false, forbidden);
});

test("driver and truck lines are optional", () => {
  const text = allText(buildLoadingReceiptLines({ ...input, driverName: null, truckLabel: undefined }));
  assert.equal(text.includes("Chauffeur"), false);
  assert.equal(text.includes("Camion"), false);
  assert.ok(text.includes("Date : 26/09/2026"));
});

test("columns: PRODUIT at the left margin, CHARGE and RECHARGE right-aligned under their titles (ESC $ positions)", () => {
  for (const sample of [input, { ...input, lines: [{ productName: "Eau", initialQuantity: 123456, reloadedQuantity: 9876543 }] }]) {
    const lines = textLines(buildLoadingReceiptLines(sample));
    const head = lines.find((t) => t.text.includes("PRODUIT"))!;
    assert.equal(head.font, "B");
    const [produit, charge, recharge] = head.cells!;
    assert.equal(produit.x, 0);
    assert.equal(recharge.x + recharge.text.length * 9, 576, "RECHARGE ends at the paper edge");
    const chargeEdge = charge.x + charge.text.length * 9;
    let productRows = 0;
    for (const row of lines.filter((t) => t.cells && t.cells.length === 3 && t.font === "A")) {
      const [name, c, r] = row.cells!;
      assert.equal(name.x, 0, "name at the left margin");
      assert.equal(c.x + c.text.length * 12, chargeEdge, "charge value ends where CHARGE ends");
      assert.equal(r.x + r.text.length * 12, 576, "recharge value ends at the paper edge");
      assert.ok(name.x + name.text.length * 12 < c.x, "the name never touches the quantities");
      productRows += 1;
    }
    assert.equal(productRows, sample.lines.length);
    for (const t of lines) assert.ok(t.text.length <= COLUMNS_FONT_A * 4 / 3, t.text);
  }
});

test("a long name wraps on 2 lines with the quantities on the first one; accents are native text", () => {
  const lines = buildLoadingReceiptLines({
    ...input,
    lines: [{ productName: "Eau minérale gazeuse naturelle en bouteille 1,5L pack économique", initialQuantity: 12, reloadedQuantity: 3 }],
  });
  const texts = textLines(lines);
  const first = texts.find((t) => t.cells && t.cells.length === 3 && t.font === "A")!;
  assert.match(first.cells![0].text, /^Eau minérale/);
  const second = texts[texts.indexOf(first) + 1];
  assert.equal(second.cells!.length, 1);
  assert.equal(second.cells![0].x, 0);
  assert.equal(lines.filter((l) => l.kind === "raster" || l.kind === "rasterCells").length, 0);
});

const fakeCells: RasterCellsRenderer = (_cells, { widthDots }) => ({ width: widthDots, height: 36, data: new Uint8Array(Math.ceil(widthDots / 8) * 36).fill(1) });

test("an Arabic product name: its WHOLE row is one image line (name never separated from its quantities)", () => {
  const sample: LoadingTicketInput = { ...input, lines: [{ productName: "مشروب غازي", initialQuantity: 10, reloadedQuantity: 5 }, { productName: "Coca", initialQuantity: 1, reloadedQuantity: 2 }] };
  const lines = buildLoadingReceiptLines(sample);
  const arabic = lines.filter((l) => l.kind === "rasterCells");
  assert.equal(arabic.length, 1);
  assert.equal(lines.filter((l) => l.kind === "raster").length, 0);
  const cells = (arabic[0] as Extract<ReceiptLine, { kind: "rasterCells" }>).cells;
  assert.deepEqual(cells.map((c) => [c.text, c.align]), [["مشروب غازي", "left"], ["10", "right"], ["5", "right"]]);
  assert.equal(cells[0].at, 0);
  assert.equal(cells[2].at, 576);
  const encoded = buildLoadingEscPos(sample, { rasterCells: fakeCells });
  assert.equal(encoded.rasterLines, 1);
  assert.ok(hasSequence(encoded.bytes, [0x1d, 0x76, 0x30, 0x00]));
  // without an image renderer the row still prints on ONE line with a marker
  const plain = buildLoadingEscPos(sample);
  assert.deepEqual(plain.unrenderedLines, ["مشروب غازي"]);
  const asText = Buffer.from(plain.bytes).toString("latin1");
  assert.ok(asText.includes("(non imprimable)") && asText.includes("10") && asText.includes("Coca"));
});

test("ESC/POS stream: init, motion unit, code page, fonts, ESC $ columns, cut", () => {
  const { bytes } = buildLoadingEscPos(input);
  assert.deepEqual([bytes[0], bytes[1]], [0x1b, 0x40]);
  assert.ok(hasSequence(bytes, [0x1d, 0x50, 203, 203]));
  assert.ok(hasSequence(bytes, [0x1b, 0x74, 19]));
  assert.ok(hasSequence(bytes, [0x1b, 0x4d, 0x01]), "font B titles");
  assert.ok(hasSequence(bytes, [0x1b, 0x24, 0, 0]), "ESC $ 0 0 : PRODUIT / names at the left margin");
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
  assert.ok(bytes.includes(Buffer.from("CHARGEMENT")));
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
