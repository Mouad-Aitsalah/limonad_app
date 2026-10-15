"use client";

import * as React from "react";
import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";

import { ThermalPrinterPanel } from "@/components/driver-pos/thermal-printer-panel";
import type { CompanyIdentity } from "@/hooks/use-company-identity";
import { shareInvoicePdf } from "@/lib/share-invoice";
import { getThermalPrinterService, isThermalPrinterAvailable } from "@/lib/thermal-printer";
import type { SaleDto } from "@/types/operations-dto";

/**
 * The driver POS ticket printing, shared by the driver POS (driver-pos-view.tsx) and the driver's
 * « Mes ventes du jour » (driver-sales-view.tsx) so both print the SAME ticket the SAME way. Moved here
 * unchanged from driver-pos-view.tsx:
 *
 *  - web / PC / phone browser: window.print() of the <ReceiptPrint sale=…/> the caller keeps mounted
 *    (the caller sets that sale before calling printSale);
 *  - Android app with the Bluetooth plugin: the ticket goes straight to the selected thermal printer
 *    (ESC/POS, no Internet needed); no printer chosen / permission missing -> the printer panel, then print;
 *  - Android without the plugin, or the printer failing: the invoice PDF handed to the phone's print
 *    service (Android's WebView has no window.print()).
 */

// FIX ANDROID PRINT BUTTON - Android's WebView never implements
// window.print() (a silent no-op there, unlike every desktop/mobile-web
// browser this app also runs in) - on native Capacitor this hands the
// SAME sale off to shareInvoicePdf's already-shipped PDF+native-share-sheet
// pipeline (see that function's own "intent: print" doc comment) instead,
// so "Imprimer" actually reaches Android's print framework. Desktop/mobile
// web is byte-for-byte unchanged: window.print() only, exactly as before.
// Android + Bluetooth plugin present: the ticket goes straight to the selected
// thermal printer (ESC/POS, no Internet needed). Bluetooth unavailable or
// failing: the PDF + share sheet below, exactly as before. Web: unchanged.
export function useDriverSalePrint({
  identity,
  customerPhone,
}: {
  identity: CompanyIdentity | null;
  /** Phone put on the PDF fallback (WhatsApp-style share sheet), when known. */
  customerPhone: string | null;
}) {
  // `thermalPrinterAvailable` is false on the web and on an APK built without the native plugin, so
  // nothing below is ever shown or run there.
  const thermalPrinterAvailable = React.useSyncExternalStore(
    () => () => {},
    () => isThermalPrinterAvailable(),
    () => false,
  );
  const [printerPanelOpen, setPrinterPanelOpen] = React.useState(false);
  const [printerPanelReason, setPrinterPanelReason] = React.useState<string | null>(null);
  const pendingPrintRef = React.useRef<{ sale: SaleDto; offlineReference: string | null } | null>(null);

  async function printSaleAsPdf(sale: SaleDto) {
    try {
      await shareInvoicePdf({ sale, identity, customerPhone }, "print");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(error instanceof Error ? error.message : "Impossible de preparer le ticket a imprimer.");
    }
  }

  async function printSale(sale: SaleDto, offlineReference: string | null) {
    if (!Capacitor.isNativePlatform()) {
      window.setTimeout(() => window.print(), 0);
      return;
    }
    if (!isThermalPrinterAvailable()) {
      await printSaleAsPdf(sale);
      return;
    }
    const result = await getThermalPrinterService().printSale(sale, { offlineReference });
    if (result.ok) {
      toast.success("Ticket imprimé avec succès");
      return;
    }
    if (result.code === "NOT_AVAILABLE") {
      await printSaleAsPdf(sale);
      return;
    }
    if (result.code === "NO_PRINTER" || result.code === "PERMISSION_REQUIRED") {
      // Ask which paired printer to use (or for the permission), then print.
      pendingPrintRef.current = { sale, offlineReference };
      setPrinterPanelReason(`${result.message} Le ticket sera imprimé dès que c'est réglé.`);
      setPrinterPanelOpen(true);
      return;
    }
    toast.error(result.message, {
      duration: 15_000,
      action: { label: "Envoyer en PDF", onClick: () => void printSaleAsPdf(sale) },
    });
  }

  /** « Imprimante » settings from the POS header (no ticket waiting). */
  function openPrinterSettings() {
    pendingPrintRef.current = null;
    setPrinterPanelReason(null);
    setPrinterPanelOpen(true);
  }

  const printerPanel = thermalPrinterAvailable ? (
    <ThermalPrinterPanel
      open={printerPanelOpen}
      onOpenChange={setPrinterPanelOpen}
      reason={printerPanelReason}
      onPrinterSelected={() => {
        const pending = pendingPrintRef.current;
        pendingPrintRef.current = null;
        if (!pending) return;
        setPrinterPanelOpen(false);
        void printSale(pending.sale, pending.offlineReference);
      }}
    />
  ) : null;

  return { printSale, thermalPrinterAvailable, openPrinterSettings, printerPanel };
}
