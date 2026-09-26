import { canvasRasterCellsRenderer, canvasRasterRenderer } from "@/lib/escpos-raster-canvas";
import type { RasterCellsRenderer, RasterRenderer } from "@/lib/escpos-receipt";
import { buildLoadingEscPos, type LoadingTicketInput } from "@/lib/escpos-loading";
import {
  getThermalPrinterService,
  isThermalPrinterAvailable,
  PRINT_FAILURE_MESSAGES,
  type PrintResult,
  type createThermalPrinterService,
} from "@/lib/thermal-printer";

type ThermalService = Pick<ReturnType<typeof createThermalPrinterService>, "printBytes">;

/**
 * Prints a loading ticket through the SAME Bluetooth service as the invoices
 * (selected printer, permission / Bluetooth checks, error codes): only the
 * ticket differs. Independent of the invoice printing function, no network.
 */
export async function printLoadingTicketWith(
  service: ThermalService,
  input: LoadingTicketInput,
  renderers: { raster?: RasterRenderer; rasterCells?: RasterCellsRenderer } = {},
): Promise<PrintResult> {
  let encoded;
  try {
    encoded = buildLoadingEscPos(input, renderers);
  } catch (error) {
    return { ok: false, code: "UNKNOWN", message: error instanceof Error ? error.message : PRINT_FAILURE_MESSAGES.UNKNOWN };
  }
  const sent = await service.printBytes(encoded.bytes);
  return sent.ok ? { ok: true, rasterLines: encoded.rasterLines, unrenderedLines: encoded.unrenderedLines.length } : sent;
}

/** Android + native Bluetooth plugin only; anything else reports NOT_AVAILABLE. */
export async function printLoadingTicket(input: LoadingTicketInput): Promise<PrintResult> {
  if (!isThermalPrinterAvailable()) {
    return { ok: false, code: "NOT_AVAILABLE", message: PRINT_FAILURE_MESSAGES.NOT_AVAILABLE };
  }
  return printLoadingTicketWith(getThermalPrinterService(), input, {
    raster: canvasRasterRenderer,
    rasterCells: canvasRasterCellsRenderer,
  });
}
