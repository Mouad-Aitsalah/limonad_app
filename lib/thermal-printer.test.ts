import assert from "node:assert/strict";
import { test } from "node:test";

import type { SaleDto } from "@/types/operations-dto";

import {
  createThermalPrinterService,
  isThermalPrinterAvailable,
  PRINT_FAILURE_MESSAGES,
  type ThermalPrinterPlugin,
  type ThermalPrinterStatus,
  type ThermalPrinterStorage,
} from "./thermal-printer";

const PRINTER = { name: "POS-8003-19DB", address: "AA:BB:CC:DD:EE:FF" };

function memoryStorage(): ThermalPrinterStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async get(key) {
      return data.get(key) ?? null;
    },
    async set(key, value) {
      data.set(key, value);
    },
    async remove(key) {
      data.delete(key);
    },
  };
}

function fakePlugin(overrides: Partial<ThermalPrinterStatus> = {}) {
  const calls: Array<{ address: string; data: string }> = [];
  const state = {
    status: {
      bluetoothSupported: true,
      bluetoothEnabled: true,
      permissionGranted: true,
      sdkInt: 34,
      connectedAddress: null,
      ...overrides,
    } as ThermalPrinterStatus,
    printError: null as null | { code?: string; message?: string },
  };
  const plugin: ThermalPrinterPlugin = {
    async getStatus() {
      return state.status;
    },
    async requestBluetoothPermission() {
      state.status = { ...state.status, permissionGranted: true };
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
      if (state.printError) throw state.printError;
      calls.push(options);
      return { bytesWritten: Buffer.from(options.data, "base64").length };
    },
    async openBluetoothSettings() {},
  };
  return { plugin, calls, state };
}

const sale = {
  id: "s1",
  displayNumber: "33/2026",
  status: "PAID",
  paymentMethod: "CASH",
  paidAmount: 12,
  creditAmount: 0,
  totalTTC: 12,
  createdAt: "2026-09-25T10:00:00.000Z",
  validatedAt: "2026-09-25T10:00:00.000Z",
  customer: null,
  driver: null,
  createdByUserName: "Chauffeur",
  payments: [],
  lines: [
    { id: "l1", productId: "p1", productName: "Coca 1L", productReference: "R", quantity: 1, unitPriceHT: 10, taxRate: 20, totalTTC: 12 },
  ],
} as unknown as SaleDto;

test("on the web / an APK without the plugin: not available, nothing is attempted", async () => {
  assert.equal(isThermalPrinterAvailable(), false);
  const service = createThermalPrinterService({ plugin: null, storage: memoryStorage() });
  const result = await service.printSale(sale);
  assert.deepEqual(result, { ok: false, code: "NOT_AVAILABLE", message: PRINT_FAILURE_MESSAGES.NOT_AVAILABLE });
  assert.equal((await service.printTest()).ok, false);
});

test("no printer selected yet: NO_PRINTER (the UI then shows the paired printers)", async () => {
  const { plugin, calls } = fakePlugin();
  const service = createThermalPrinterService({ plugin, storage: memoryStorage() });
  const result = await service.printSale(sale);
  assert.equal(result.ok === false && result.code, "NO_PRINTER");
  assert.equal(calls.length, 0);
});

test("the chosen printer is remembered (Preferences) and used for the next print", async () => {
  const storage = memoryStorage();
  const first = fakePlugin();
  const service = createThermalPrinterService({ plugin: first.plugin, storage });
  await service.selectPrinter(PRINTER);
  assert.deepEqual(await service.getSelectedPrinter(), PRINTER);

  // "close the app": a brand-new service over the same storage still knows it
  const second = fakePlugin();
  const reopened = createThermalPrinterService({ plugin: second.plugin, storage });
  assert.deepEqual(await reopened.getSelectedPrinter(), PRINTER);
  const result = await reopened.printSale(sale);
  assert.equal(result.ok, true);
  assert.equal(second.calls.length, 1);
  assert.equal(second.calls[0].address, PRINTER.address);

  await reopened.clearSelectedPrinter();
  assert.equal(await reopened.getSelectedPrinter(), null);
});

test("prints without any network access, and sends real ESC/POS bytes", async () => {
  const storage = memoryStorage();
  const { plugin, calls } = fakePlugin();
  const service = createThermalPrinterService({ plugin, storage });
  await service.selectPrinter(PRINTER);

  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("network must not be used to print");
  }) as typeof fetch;
  try {
    const result = await service.printSale(sale);
    assert.equal(result.ok, true);
  } finally {
    globalThis.fetch = realFetch;
  }
  const bytes = Buffer.from(calls[0].data, "base64");
  assert.deepEqual([bytes[0], bytes[1]], [0x1b, 0x40]);
  assert.deepEqual(Array.from(bytes.subarray(-4)), [0x1d, 0x56, 0x42, 0x00]);
  assert.ok(bytes.includes(Buffer.from("TOTAL TTC")));
});

test("Bluetooth permission missing: PERMISSION_REQUIRED and nothing is sent", async () => {
  const storage = memoryStorage();
  const { plugin, calls } = fakePlugin({ permissionGranted: false });
  const service = createThermalPrinterService({ plugin, storage });
  await service.selectPrinter(PRINTER);
  const result = await service.printSale(sale);
  assert.equal(result.ok === false && result.code, "PERMISSION_REQUIRED");
  assert.equal(calls.length, 0);
  // once the user allows it, the same call goes through
  await plugin.requestBluetoothPermission();
  assert.equal((await service.printSale(sale)).ok, true);
});

test("Bluetooth switched off: BLUETOOTH_OFF with a clear message", async () => {
  const storage = memoryStorage();
  const { plugin, calls } = fakePlugin({ bluetoothEnabled: false });
  const service = createThermalPrinterService({ plugin, storage });
  await service.selectPrinter(PRINTER);
  const result = await service.printSale(sale);
  assert.equal(result.ok === false && result.code, "BLUETOOTH_OFF");
  assert.match(result.ok === false ? result.message : "", /Bluetooth est désactivé/);
  assert.equal(calls.length, 0);
});

test("native failures are mapped to explicit codes so the app can offer the PDF fallback", async () => {
  const cases: Array<[string, string]> = [
    ["CONNECT_FAILED", "CONNECT_FAILED"],
    ["WRITE_FAILED", "WRITE_FAILED"],
    ["NOT_PAIRED", "NOT_PAIRED"],
    ["BT_DISABLED", "BLUETOOTH_OFF"],
    ["PERMISSION_DENIED", "PERMISSION_REQUIRED"],
    ["SOMETHING_ELSE", "WRITE_FAILED"],
  ];
  for (const [nativeCode, expected] of cases) {
    const storage = memoryStorage();
    const { plugin, state } = fakePlugin();
    state.printError = { code: nativeCode, message: "detail" };
    const service = createThermalPrinterService({ plugin, storage });
    await service.selectPrinter(PRINTER);
    const result = await service.printSale(sale);
    assert.equal(result.ok === false && result.code, expected, nativeCode);
    assert.match(result.ok === false ? result.message : "", /detail/);
  }
});

test("test print: real ticket to the SELECTED printer (name not hard-coded), needs a printer", async () => {
  const storage = memoryStorage();
  const { plugin, calls } = fakePlugin();
  const service = createThermalPrinterService({ plugin, storage });
  assert.equal((await service.printTest()).ok === false && (await service.printTest()).ok, false);

  await service.selectPrinter({ name: "Ma petite imprimante", address: "11:22:33:44:55:66" });
  const result = await service.printTest();
  assert.equal(result.ok, true);
  assert.equal(calls[0].address, "11:22:33:44:55:66");
  const bytes = Buffer.from(calls[0].data, "base64");
  assert.ok(bytes.includes(Buffer.from("TEST IMPRESSION")));
  assert.ok(bytes.includes(Buffer.from("Imprimante : Ma petite imprimante")));
  assert.ok(bytes.includes(Buffer.from("Bluetooth : OK")));
  assert.equal(bytes.includes(Buffer.from("POS-8003-19DB")), false);

  // an explicit printer (just picked in the list) works before it is remembered
  const other = await service.printTest(PRINTER);
  assert.equal(other.ok, true);
  assert.ok(Buffer.from(calls[1].data, "base64").includes(Buffer.from("Imprimante : POS-8003-19DB")));
});
