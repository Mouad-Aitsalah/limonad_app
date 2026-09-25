"use client";

import * as React from "react";
import { Bluetooth, BluetoothOff, CheckCircle2, Printer, RefreshCw, Settings2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getThermalPrinterPlugin,
  getThermalPrinterService,
  type PairedPrinter,
  type ThermalPrinterStatus,
} from "@/lib/thermal-printer";

type PairedPrinterRow = PairedPrinter & { printerLike?: boolean };

type ThermalPrinterPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Why the panel opened by itself (e.g. no printer selected yet while printing a ticket). */
  reason?: string | null;
  /** Called once the user picked a printer - lets a pending "Imprimer" continue. */
  onPrinterSelected?: (printer: PairedPrinter) => void;
};

/**
 * "Imprimante" screen of the Android driver POS: current printer, Bluetooth
 * state, choice among the ALREADY PAIRED devices (no scan), real test ticket,
 * shortcut to Android's Bluetooth settings. Rendered only when the native
 * plugin exists (see driver-pos-view.tsx), so it never appears on the web.
 */
export function ThermalPrinterPanel({ open, onOpenChange, reason = null, onPrinterSelected }: ThermalPrinterPanelProps) {
  const plugin = getThermalPrinterPlugin();
  const service = getThermalPrinterService();

  const [status, setStatus] = React.useState<ThermalPrinterStatus | null>(null);
  const [selected, setSelected] = React.useState<PairedPrinter | null>(null);
  const [printers, setPrinters] = React.useState<PairedPrinterRow[] | null>(null);
  const [busy, setBusy] = React.useState<null | "list" | "test" | "permission">(null);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    if (!plugin) return;
    try {
      setStatus(await plugin.getStatus());
    } catch {
      setStatus(null);
    }
    setSelected(await service.getSelectedPrinter());
  }, [plugin, service]);

  React.useEffect(() => {
    if (!open) return;
    void Promise.resolve().then(refresh);
  }, [open, refresh]);

  async function requestPermission() {
    if (!plugin) return;
    setBusy("permission");
    setError(null);
    try {
      const { granted } = await plugin.requestBluetoothPermission();
      // A print was waiting for this permission and a printer is already chosen: go on.
      if (granted && selected) onPrinterSelected?.(selected);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Autorisation refusée.");
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  async function chooseFromPaired() {
    if (!plugin) return;
    setBusy("list");
    setError(null);
    try {
      const result = await plugin.listPairedPrinters();
      // Printers first, then everything else: the list is what Android already paired.
      const rows = [...(result.printers as PairedPrinterRow[])].sort(
        (a, b) => Number(Boolean(b.printerLike)) - Number(Boolean(a.printerLike)) || a.name.localeCompare(b.name),
      );
      setPrinters(rows);
      await refresh();
    } catch (cause) {
      const message = (cause as { message?: string } | null)?.message;
      setError(message ?? "Impossible de lister les appareils Bluetooth.");
      setPrinters(null);
    } finally {
      setBusy(null);
    }
  }

  async function pick(printer: PairedPrinterRow) {
    await service.selectPrinter({ name: printer.name, address: printer.address });
    setSelected({ name: printer.name, address: printer.address });
    setPrinters(null);
    toast.success(`Imprimante sélectionnée : ${printer.name}`);
    onPrinterSelected?.({ name: printer.name, address: printer.address });
  }

  async function runTest() {
    setBusy("test");
    setError(null);
    try {
      const result = await service.printTest();
      if (result.ok) {
        toast.success("Test envoyé à l'imprimante.");
      } else {
        setError(result.message);
      }
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  const connected = Boolean(selected && status?.connectedAddress && status.connectedAddress === selected.address);
  const permissionMissing = status !== null && !status.permissionGranted;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Printer aria-hidden="true" className="h-5 w-5" />
            Imprimante
          </DialogTitle>
          <DialogDescription>
            {reason ?? "Ticket thermique 80 mm par Bluetooth. Aucune connexion Internet n'est nécessaire."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm" data-testid="thermal-printer-panel">
          <div className="rounded-xl border border-border p-3">
            <p className="text-xs text-muted-foreground">Imprimante actuelle</p>
            <p className="text-base font-semibold" data-testid="thermal-printer-current">
              {selected ? selected.name : "Aucune imprimante sélectionnée"}
            </p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">Bluetooth</dt>
              <dd className="flex items-center gap-1.5 font-medium">
                {status?.bluetoothEnabled ? (
                  <>
                    <Bluetooth aria-hidden="true" className="h-4 w-4 text-emerald-600" /> Activé
                  </>
                ) : (
                  <>
                    <BluetoothOff aria-hidden="true" className="h-4 w-4 text-red-600" />{" "}
                    {permissionMissing ? "Autorisation requise" : "Désactivé"}
                  </>
                )}
              </dd>
              <dt className="text-muted-foreground">Connexion</dt>
              <dd className="flex items-center gap-1.5 font-medium">
                {connected ? (
                  <>
                    <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-emerald-600" /> Connectée
                  </>
                ) : (
                  "Non connectée"
                )}
              </dd>
            </dl>
          </div>

          {permissionMissing ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900">
              <p className="font-medium">Autorisation Bluetooth nécessaire</p>
              <p className="mt-1">
                Android demande votre accord pour que COMDIS puisse se connecter à l&apos;imprimante déjà appairée.
                Nous n&apos;utilisons ni la localisation ni la recherche d&apos;appareils.
              </p>
              <Button type="button" className="mt-2" disabled={busy !== null} onClick={() => void requestPermission()}>
                Autoriser le Bluetooth
              </Button>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-800">
              {error}
            </p>
          ) : null}

          <div className="grid gap-2">
            <Button type="button" disabled={busy !== null || permissionMissing} onClick={() => void chooseFromPaired()}>
              <RefreshCw aria-hidden="true" className={busy === "list" ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              Choisir une imprimante
            </Button>

            {printers !== null ? (
              <div className="grid gap-1.5" data-testid="thermal-printer-list">
                {printers.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border p-3 text-muted-foreground">
                    Aucun appareil appairé. Appairez d&apos;abord l&apos;imprimante dans les paramètres Bluetooth
                    (code habituel : 0000 ou 1234), puis revenez ici.
                  </p>
                ) : (
                  printers.map((printer) => {
                    const isSelected = selected?.address === printer.address;
                    const isConnected = status?.connectedAddress === printer.address;
                    return (
                      <button
                        key={printer.address}
                        type="button"
                        onClick={() => void pick(printer)}
                        className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-left transition-colors active:bg-accent ${
                          isSelected ? "border-emerald-500 bg-emerald-50" : "border-border"
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{printer.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">{printer.address}</span>
                        </span>
                        <span className="shrink-0 text-xs font-medium">
                          {isConnected ? "Connectée" : "Non connectée"}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            ) : null}

            <Button
              type="button"
              variant="outline"
              disabled={busy !== null || !selected || permissionMissing}
              onClick={() => void runTest()}
            >
              <Printer aria-hidden="true" className="h-4 w-4" />
              {busy === "test" ? "Impression du test..." : "Tester l'impression"}
            </Button>

            <Button
              type="button"
              variant="outline"
              disabled={busy !== null}
              onClick={() => void plugin?.openBluetoothSettings()}
            >
              <Settings2 aria-hidden="true" className="h-4 w-4" />
              Ouvrir les paramètres Bluetooth
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
