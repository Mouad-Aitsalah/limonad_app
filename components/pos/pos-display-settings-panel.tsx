"use client";

import * as React from "react";
import { RotateCcw, SlidersHorizontal, X } from "lucide-react";

import { posDisplayStore, usePosDisplaySettings } from "@/components/pos/use-pos-display-settings";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  POS_DISPLAY_LIMITS,
  isDefaultPosDisplay,
  isValidDisplayScope,
  type DisplayScope,
  type PosDisplayNumericKey,
} from "@/lib/pos-display-settings";

const SLIDERS: Array<{ key: PosDisplayNumericKey; label: string; hint: string }> = [
  { key: "nameSize", label: "Taille du nom du produit", hint: "Texte du nom uniquement" },
  { key: "cardMinWidth", label: "Largeur minimale de la carte", hint: "Plus large = moins de cartes par ligne" },
  { key: "imageHeight", label: "Hauteur de l'image", hint: "Hauteur de la photo du produit" },
  { key: "gap", label: "Espacement entre les cartes", hint: "Écart horizontal et vertical" },
];

/**
 * "Personnaliser l'affichage" button + non-modal panel (the catalogue stays
 * visible and updates live while a slider moves). Visual settings only.
 *
 * `scope` = the signed-in organisation + user: it selects whose saved settings
 * are loaded and where they are written (this browser, per account). Without a
 * scope nothing is saved and the panel says so.
 */
export function PosDisplaySettingsPanel({ scope, defaultOpen = false }: { scope: DisplayScope | null; defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const settings = usePosDisplaySettings();
  const panelId = React.useId();
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const signedIn = isValidDisplayScope(scope);

  // Whose settings are shown / saved - loaded as soon as the user is known.
  const organizationId = scope?.organizationId ?? null;
  const userId = scope?.userId ?? null;
  React.useEffect(() => {
    posDisplayStore.setScope(organizationId && userId ? { organizationId, userId } : null);
  }, [organizationId, userId]);

  // A change not written yet is written when the page is left or hidden.
  React.useEffect(() => {
    const flush = () => posDisplayStore.flush();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      flush();
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
    };
  }, []);

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

  return (
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-label="Personnaliser l'affichage"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((current) => !current)}
        className="flex h-12 w-12 items-center justify-center rounded-2xl border border-input bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:border-emerald-500 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-emerald-500/15 aria-expanded:border-emerald-500 aria-expanded:text-emerald-700"
      >
        <SlidersHorizontal aria-hidden="true" className="size-5" />
      </button>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Personnaliser l'affichage"
          className="z-50 w-[22rem] max-w-[calc(100vw-1.5rem)] rounded-2xl border border-border bg-card p-4 text-foreground shadow-[0_20px_50px_rgba(15,23,42,0.18)] max-lg:fixed max-lg:inset-x-3 max-lg:bottom-3 max-lg:w-auto max-lg:max-h-[70vh] max-lg:overflow-y-auto lg:absolute lg:top-full lg:right-0 lg:mt-2"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Personnaliser l&apos;affichage</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Catalogue des produits uniquement</p>
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

          <div className="mt-4 space-y-4">
            {SLIDERS.map(({ key, label, hint }) => {
              const limits = POS_DISPLAY_LIMITS[key];
              const inputId = `${panelId}-${key}`;
              return (
                <div key={key}>
                  <div className="flex items-baseline justify-between gap-2">
                    <label htmlFor={inputId} className="text-sm font-medium">
                      {label}
                    </label>
                    <output htmlFor={inputId} className="text-sm font-semibold tabular-nums text-emerald-700">
                      {settings[key]} px
                    </output>
                  </div>
                  <input
                    id={inputId}
                    type="range"
                    min={limits.min}
                    max={limits.max}
                    step={1}
                    value={settings[key]}
                    onChange={(event) => posDisplayStore.update({ [key]: Number(event.target.value) })}
                    aria-valuetext={`${settings[key]} pixels`}
                    className="mt-1.5 h-6 w-full cursor-pointer accent-emerald-600 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-emerald-500/30"
                  />
                  <div className="flex justify-between text-[11px] text-muted-foreground">
                    <span>{limits.min} px</span>
                    <span>{hint}</span>
                    <span>{limits.max} px</span>
                  </div>
                </div>
              );
            })}

            <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2.5">
              <label htmlFor={`${panelId}-photos`} className="text-sm font-medium">
                Afficher les photos des produits
              </label>
              <Switch
                id={`${panelId}-photos`}
                checked={settings.showPhotos}
                onCheckedChange={(checked) => posDisplayStore.update({ showPhotos: checked })}
              />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => posDisplayStore.reset()}
              disabled={isDefaultPosDisplay(settings)}
            >
              <RotateCcw aria-hidden="true" className="size-3.5" />
              Réinitialiser
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setOpen(false);
                buttonRef.current?.focus();
              }}
            >
              Fermer
            </Button>
          </div>

          <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
            {signedIn
              ? "Réglages enregistrés sur ce navigateur pour votre compte ; ils ne sont pas synchronisés entre vos appareils."
              : "Réglages valables pour cette page : ils ne sont pas enregistrés tant que vous n'êtes pas identifié."}
          </p>
        </div>
      ) : null}
    </div>
  );
}
