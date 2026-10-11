"use client";

import * as React from "react";
import { Lock, Settings2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  PRODUCT_COLUMNS,
  isProductColumnVisible,
  withProductColumnVisibility,
  type ProductColumnKey,
  type ProductColumnSettings,
} from "@/lib/product-columns";

/**
 * "Colonnes" gear + non-modal panel of /produits (ADMIN ONLY - the page does
 * not render it for another role, and the API refuses them anyway). Each
 * switch updates the table at once and is saved for the whole organisation
 * (PUT /api/organization/product-columns); a refused save puts the previous
 * choice back. Display only: no product data is ever touched.
 */
export function ProductColumnsPanel({
  settings,
  onSettingsChange,
}: {
  settings: ProductColumnSettings;
  onSettingsChange: (settings: ProductColumnSettings) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const panelId = React.useId();
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  // Saves are chained so two quick toggles reach the server in order.
  const queueRef = React.useRef<Promise<void>>(Promise.resolve());

  React.useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function toggle(key: ProductColumnKey, visible: boolean) {
    const previous = settings;
    const next = withProductColumnVisibility(settings, key, visible);
    onSettingsChange(next);
    queueRef.current = queueRef.current.then(async () => {
      setSaving(true);
      try {
        const response = await fetch("/api/organization/product-columns", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });
        const body = (await response.json().catch(() => ({}))) as {
          settings?: ProductColumnSettings;
          message?: string;
        };
        if (!response.ok || !body.settings) {
          onSettingsChange(previous);
          toast.error(body.message ?? "Impossible d'enregistrer les colonnes.");
        }
      } catch {
        onSettingsChange(previous);
        toast.error("Impossible d'enregistrer les colonnes.");
      } finally {
        setSaving(false);
      }
    });
  }

  return (
    <div className="relative">
      <Button
        ref={buttonRef}
        type="button"
        variant="outline"
        size="sm"
        aria-label="Paramètres des colonnes"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <Settings2 aria-hidden="true" className="h-4 w-4" />
        Colonnes
      </Button>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Colonnes du tableau Produits"
          className="z-50 w-[22rem] max-w-[calc(100vw-1.5rem)] rounded-2xl border border-border bg-card p-4 text-foreground shadow-[0_20px_50px_rgba(15,23,42,0.18)] max-lg:fixed max-lg:inset-x-3 max-lg:bottom-3 max-lg:w-auto max-lg:max-h-[70vh] max-lg:overflow-y-auto lg:absolute lg:top-full lg:left-0 lg:mt-2"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Colonnes du tableau</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Pour toute l&apos;organisation · {saving ? "enregistrement…" : "enregistré"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                buttonRef.current?.focus();
              }}
              aria-label="Fermer le panneau"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-emerald-500/20"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>

          <ul className="mt-3 max-h-[60vh] space-y-1 overflow-y-auto">
            {PRODUCT_COLUMNS.map((column) => {
              const inputId = `${panelId}-${column.key}`;
              return (
                <li
                  key={column.key}
                  className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/40"
                >
                  <label htmlFor={inputId} className="flex items-center gap-1.5 text-sm">
                    {column.label}
                    {column.locked ? (
                      <Lock aria-label="Toujours affichée" className="size-3 text-muted-foreground" />
                    ) : null}
                  </label>
                  <Switch
                    id={inputId}
                    size="sm"
                    checked={isProductColumnVisible(settings, column.key)}
                    disabled={column.locked}
                    onCheckedChange={(checked) => toggle(column.key, checked)}
                  />
                </li>
              );
            })}
          </ul>

          <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
            Masquer une colonne ne modifie aucune donnée produit. La désignation reste toujours affichée. Les cartes
            sur téléphone ne changent pas.
          </p>
        </div>
      ) : null}
    </div>
  );
}
