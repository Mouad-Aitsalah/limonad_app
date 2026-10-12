"use client";

import * as React from "react";
import { Settings2 } from "lucide-react";

import { InfoHint } from "@/components/dashboard/commercial/analysis-ui";
import { Input } from "@/components/ui/input";
import { MAX_OVERDUE_DAYS, MIN_OVERDUE_DAYS, validateOverdueDays } from "@/lib/receivables/settings";
import type { ReceivablesSettings } from "@/types/receivables";

const HINT =
  "Une créance est « en retard » quand la part encore ouverte d'une vente à crédit (estimation FIFO) a plus de ce nombre de jours. Réglage de l'organisation, réservé à l'admin. Indépendant des tranches d'ancienneté et de l'indicateur « plus de 30 jours ».";

/** « Délai de retard : N jours · Modifier » - the admin's setting, saved for the organisation. */
export function OverdueDaysSetting({ settings, onSaved }: { settings: ReceivablesSettings; onSaved: (settings: ReceivablesSettings) => void }) {
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(String(settings.overdueDays));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputId = React.useId();

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const validation = validateOverdueDays(value);
    if (!validation.ok) {
      setError(validation.message);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/dashboard/receivables/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overdueDays: validation.value }),
      });
      const body = (await response.json().catch(() => ({}))) as { settings?: ReceivablesSettings; message?: string };
      if (!response.ok || !body.settings) {
        setError(response.status === 403 ? "Réglage réservé à l'administrateur." : (body.message ?? "Enregistrement impossible."));
        return;
      }
      setEditing(false);
      onSaved(body.settings);
    } catch {
      setError("Enregistrement impossible. Vérifiez la connexion.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs" data-setting="overdue-days">
        <span className="text-muted-foreground">Délai de retard :</span>
        <strong className="tabular-nums text-foreground">{settings.overdueDays} jours</strong>
        {settings.isDefault ? <span className="text-muted-foreground">(par défaut)</span> : null}
        <InfoHint label="Délai de retard" text={HINT} />
        <button
          type="button"
          onClick={() => {
            setValue(String(settings.overdueDays));
            setError(null);
            setEditing(true);
          }}
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-2 py-1 font-semibold text-foreground hover:bg-muted/40"
        >
          <Settings2 aria-hidden="true" className="size-3.5" />
          Modifier
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={save} className="flex flex-wrap items-center gap-2 text-xs" data-setting="overdue-days-form">
      <label htmlFor={inputId} className="text-muted-foreground">
        Délai de retard (jours)
      </label>
      <Input
        id={inputId}
        type="number"
        inputMode="numeric"
        min={MIN_OVERDUE_DAYS}
        max={MAX_OVERDUE_DAYS}
        step={1}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="h-8 w-24"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${inputId}-error` : undefined}
        autoFocus
      />
      <button type="submit" disabled={saving} className="rounded-lg bg-foreground px-3 py-1.5 font-semibold text-background disabled:opacity-60">
        {saving ? "Enregistrement…" : "Enregistrer"}
      </button>
      <button type="button" disabled={saving} onClick={() => setEditing(false)} className="rounded-lg border border-border px-3 py-1.5 font-semibold">
        Annuler
      </button>
      {error ? (
        <p id={`${inputId}-error`} role="alert" className="w-full text-red-700">
          {error}
        </p>
      ) : null}
    </form>
  );
}
