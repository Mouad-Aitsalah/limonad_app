"use client";

import * as React from "react";
import { toast } from "sonner";

import { SettingsNav } from "@/components/parametres/settings-nav";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { PricingSettingsDto } from "@/lib/server/organization-settings";

/**
 * Paramètres -> Tarification (admin only, enforced by the page loader and the
 * API). One organisation-wide switch: when on, the counter POS picks the
 * détail / semi-gros / gros price from the quantity of each product in the
 * cart - for the products whose four tier values are set. Saved on the server
 * (Organization.quantityPricingEnabled), never in the browser.
 */
export function PricingSettingsView({ initialSettings }: { initialSettings: PricingSettingsDto }) {
  const [enabled, setEnabled] = React.useState(initialSettings.quantityPricingEnabled);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const switchId = React.useId();

  async function save(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/organization/pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantityPricingEnabled: next }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        settings?: PricingSettingsDto;
        message?: string;
      };
      if (!response.ok || !body.settings) {
        setError(body.message ?? "Enregistrement impossible.");
        return;
      }
      setEnabled(body.settings.quantityPricingEnabled);
      toast.success(
        body.settings.quantityPricingEnabled
          ? "Tarification selon la quantité activée."
          : "Tarification selon la quantité désactivée.",
      );
    } catch {
      setError("Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Paramètres</h1>
        <p className="text-sm text-muted-foreground">Tarification</p>
      </div>

      <SettingsNav />

      <Card className="max-w-2xl ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
        <CardContent className="space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor={switchId} className="text-sm font-semibold text-foreground">
                Activer la tarification automatique selon la quantité
              </Label>
              <p className="text-sm text-muted-foreground">
                {enabled ? "Activée pour toute l'organisation." : "Désactivée : le POS vend au prix gros, comme avant."}
              </p>
            </div>
            <Switch
              id={switchId}
              checked={enabled}
              disabled={busy}
              onCheckedChange={(checked) => void save(checked)}
            />
          </div>

          {error ? <p className="text-xs text-destructive">{error}</p> : null}

          <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
            <p>
              Au POS comptoir, le prix unitaire dépend de la quantité totale <strong className="text-foreground">Q</strong> du
              produit dans le panier :
            </p>
            <ul className="list-disc space-y-0.5 pl-5">
              <li>Q inférieure à Qped : prix détail ;</li>
              <li>Q entre Qped (inclus) et Qgros (exclu) : prix semi-gros ;</li>
              <li>Q égale ou supérieure à Qgros : prix gros.</li>
            </ul>
            <p>
              Un produit dont le prix détail, le prix semi-gros, Qped ou Qgros manque (ou avec Qped ≥ Qgros) reste au prix
              gros. Le prix manuel saisi par un administrateur reste prioritaire. Le POS chauffeur et l&apos;Espace Client
              restent au prix gros. Les ventes déjà enregistrées ne changent pas.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
