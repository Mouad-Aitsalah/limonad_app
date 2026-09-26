import { Capacitor, registerPlugin } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

import { canvasRasterCellsRenderer, canvasRasterRenderer } from "@/lib/escpos-raster-canvas";
import {
  buildReceiptEscPos,
  buildTestEscPos,
  type RasterCellsRenderer,
  type RasterRenderer,
  type ReceiptOptions,
} from "@/lib/escpos-receipt";
import type { SaleDto } from "@/types/operations-dto";

/**
 * Bluetooth thermal printing from the Android driver app.
 *
 * The native side (android/.../ThermalPrinterPlugin.java) only lists the
 * already-paired Bluetooth devices, opens an RFCOMM/SPP socket and writes raw
 * bytes. Everything else - the ticket, ESC/POS, the accents, the raster lines,
 * the remembered printer, the errors - lives here in TypeScript, works from the
 * local sale and needs no Internet.
 *
 * Every entry point is safe on the web/PC and on an Android app whose APK does
 * not contain the plugin yet: `isThermalPrinterAvailable()` is then false and
 * the caller keeps today's behaviour (window.print() / PDF share sheet).
 */

export type PairedPrinter = { name: string; address: string };

export type ThermalPrinterStatus = {
  bluetoothSupported: boolean;
  bluetoothEnabled: boolean;
  /** Android 12+ needs BLUETOOTH_CONNECT at runtime; older versions: always true. */
  permissionGranted: boolean;
  sdkInt: number;
  connectedAddress: string | null;
};

export interface ThermalPrinterPlugin {
  getStatus(): Promise<ThermalPrinterStatus>;
  requestBluetoothPermission(): Promise<{ granted: boolean }>;
  listPairedPrinters(): Promise<{ printers: PairedPrinter[]; connectedAddress: string | null }>;
  connect(options: { address: string }): Promise<{ connected: boolean }>;
  disconnect(): Promise<void>;
  print(options: { address: string; data: string }): Promise<{ bytesWritten: number }>;
  openBluetoothSettings(): Promise<void>;
}

export type PrintFailureCode =
  | "NOT_AVAILABLE" // web, or an APK without the plugin
  | "NO_PRINTER" // nothing selected yet
  | "PERMISSION_REQUIRED" // Bluetooth permission not granted (Android 12+)
  | "BLUETOOTH_OFF"
  | "NOT_PAIRED" // the selected printer is no longer among the paired devices
  | "CONNECT_FAILED"
  | "WRITE_FAILED"
  | "UNKNOWN";

export type PrintFailure = { ok: false; code: PrintFailureCode; message: string };

export type PrintResult =
  | { ok: true; rasterLines: number; unrenderedLines: number }
  | PrintFailure;

const SELECTED_PRINTER_KEY = "comdis.thermalPrinter.selected";

export const PRINT_FAILURE_MESSAGES: Record<PrintFailureCode, string> = {
  NOT_AVAILABLE: "L'impression Bluetooth n'est pas disponible dans cette version de l'application.",
  NO_PRINTER: "Aucune imprimante Bluetooth n'est sélectionnée.",
  PERMISSION_REQUIRED: "L'autorisation Bluetooth est nécessaire pour imprimer.",
  BLUETOOTH_OFF: "Le Bluetooth est désactivé. Activez-le puis réessayez.",
  NOT_PAIRED: "L'imprimante sélectionnée n'est plus appairée avec ce téléphone.",
  CONNECT_FAILED: "Connexion à l'imprimante impossible. Vérifiez qu'elle est allumée et à proximité.",
  WRITE_FAILED: "L'envoi du ticket à l'imprimante a échoué.",
  UNKNOWN: "Erreur d'impression.",
};

export type ThermalPrinterStorage = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
};

export type ThermalPrinterDeps = {
  plugin: ThermalPrinterPlugin | null;
  storage: ThermalPrinterStorage;
  raster?: RasterRenderer;
  rasterCells?: RasterCellsRenderer;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 8_192;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

function failure(code: PrintFailureCode, detail?: string): PrintFailure {
  return { ok: false, code, message: PRINT_FAILURE_MESSAGES[code] + (detail ? ` (${detail})` : "") };
}

function failureFrom(error: unknown, fallback: PrintFailureCode): PrintFailure {
  const raw = error as { code?: string; message?: string } | null;
  const map: Record<string, PrintFailureCode> = {
    PERMISSION_DENIED: "PERMISSION_REQUIRED",
    BT_DISABLED: "BLUETOOTH_OFF",
    BT_UNAVAILABLE: "NOT_AVAILABLE",
    NOT_PAIRED: "NOT_PAIRED",
    CONNECT_FAILED: "CONNECT_FAILED",
    WRITE_FAILED: "WRITE_FAILED",
  };
  const code = (raw?.code && map[raw.code]) || fallback;
  return failure(code, raw?.message);
}

export function createThermalPrinterService(deps: ThermalPrinterDeps) {
  const { plugin, storage } = deps;

  async function getSelectedPrinter(): Promise<PairedPrinter | null> {
    try {
      const raw = await storage.get(SELECTED_PRINTER_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<PairedPrinter>;
      return typeof parsed.address === "string" && parsed.address
        ? { address: parsed.address, name: typeof parsed.name === "string" ? parsed.name : parsed.address }
        : null;
    } catch {
      return null;
    }
  }

  async function selectPrinter(printer: PairedPrinter): Promise<void> {
    await storage.set(SELECTED_PRINTER_KEY, JSON.stringify({ name: printer.name, address: printer.address }));
  }

  async function clearSelectedPrinter(): Promise<void> {
    await storage.remove(SELECTED_PRINTER_KEY);
  }

  /** Bluetooth on and permission granted, or the reason why not. */
  async function checkReady(): Promise<{ ok: true } | PrintFailure> {
    if (!plugin) return failure("NOT_AVAILABLE");
    try {
      const status = await plugin.getStatus();
      if (!status.bluetoothSupported) return failure("NOT_AVAILABLE");
      if (!status.permissionGranted) return failure("PERMISSION_REQUIRED");
      if (!status.bluetoothEnabled) return failure("BLUETOOTH_OFF");
      return { ok: true };
    } catch (error) {
      return failureFrom(error, "UNKNOWN");
    }
  }

  async function printBytes(bytes: Uint8Array, printerOverride?: PairedPrinter): Promise<{ ok: true } | PrintFailure> {
    const ready = await checkReady();
    if (!ready.ok) return ready;
    const printer = printerOverride ?? (await getSelectedPrinter());
    if (!printer) return failure("NO_PRINTER");
    try {
      await plugin!.print({ address: printer.address, data: bytesToBase64(bytes) });
      return { ok: true };
    } catch (error) {
      return failureFrom(error, "WRITE_FAILED");
    }
  }

  async function printSale(sale: SaleDto, options: ReceiptOptions = {}): Promise<PrintResult> {
    if (!plugin) return failure("NOT_AVAILABLE");
    let encoded;
    try {
      encoded = buildReceiptEscPos(sale, { ...options, raster: deps.raster, rasterCells: deps.rasterCells });
    } catch (error) {
      return failure("UNKNOWN", error instanceof Error ? error.message : undefined);
    }
    const sent = await printBytes(encoded.bytes);
    return sent.ok
      ? { ok: true, rasterLines: encoded.rasterLines, unrenderedLines: encoded.unrenderedLines.length }
      : sent;
  }

  async function printTest(printerOverride?: PairedPrinter): Promise<PrintResult> {
    if (!plugin) return failure("NOT_AVAILABLE");
    const printer = printerOverride ?? (await getSelectedPrinter());
    if (!printer) return failure("NO_PRINTER");
    const encoded = buildTestEscPos({ printerName: printer.name, raster: deps.raster });
    const sent = await printBytes(encoded.bytes, printer);
    return sent.ok
      ? { ok: true, rasterLines: encoded.rasterLines, unrenderedLines: encoded.unrenderedLines.length }
      : sent;
  }

  return { getSelectedPrinter, selectPrinter, clearSelectedPrinter, checkReady, printBytes, printSale, printTest };
}

// ---------------------------------------------------------------------------
// The real thing (Android native only)
// ---------------------------------------------------------------------------

const PLUGIN_NAME = "ThermalPrinter";

let cachedPlugin: ThermalPrinterPlugin | null | undefined;

/** The native plugin, or null on web / an APK built before the plugin existed. */
export function getThermalPrinterPlugin(): ThermalPrinterPlugin | null {
  if (cachedPlugin !== undefined) return cachedPlugin;
  cachedPlugin =
    Capacitor.isNativePlatform() && Capacitor.isPluginAvailable(PLUGIN_NAME)
      ? registerPlugin<ThermalPrinterPlugin>(PLUGIN_NAME)
      : null;
  return cachedPlugin;
}

export function isThermalPrinterAvailable(): boolean {
  return getThermalPrinterPlugin() !== null;
}

const preferencesStorage: ThermalPrinterStorage = {
  async get(key) {
    return (await Preferences.get({ key })).value;
  },
  async set(key, value) {
    await Preferences.set({ key, value });
  },
  async remove(key) {
    await Preferences.remove({ key });
  },
};

let defaultService: ReturnType<typeof createThermalPrinterService> | null = null;

export function getThermalPrinterService() {
  if (!defaultService) {
    defaultService = createThermalPrinterService({
      plugin: getThermalPrinterPlugin(),
      storage: preferencesStorage,
      raster: canvasRasterRenderer,
      rasterCells: canvasRasterCellsRenderer,
    });
  }
  return defaultService;
}
