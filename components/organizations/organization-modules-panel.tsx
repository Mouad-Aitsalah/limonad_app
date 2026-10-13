"use client";

import * as React from "react";
import { Lock, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { MODULES, type ModuleKey } from "@/lib/modules/registry";
import type { ModuleState } from "@/lib/modules/settings";
import { roleLabels } from "@/lib/roles";

type OrganizationModulesPanelProps = {
  organizationId: string;
  /** Server-loaded state; null when it could not be loaded (the panel then offers a retry). */
  initialModules: ModuleState[] | null;
};

function toRecord(modules: ModuleState[]): Record<ModuleKey, boolean> {
  return Object.fromEntries(modules.map((module) => [module.key, module.enabled])) as Record<ModuleKey, boolean>;
}

const GROUPS = Array.from(new Set(MODULES.map((module) => module.group)));

/**
 * SUPER_ADMIN: "Modules autorisés" of one organisation. The switches edit a
 * draft; "Enregistrer" sends the whole choice (PUT /api/organizations/[id]/modules,
 * SUPER_ADMIN only on the server) and shows the saved state. Essential modules
 * are shown locked. Disabling a module hides it AND refuses its pages and API
 * for that organisation only; its data is kept.
 */
export function OrganizationModulesPanel({ organizationId, initialModules }: OrganizationModulesPanelProps) {
  const [saved, setSaved] = React.useState<Record<ModuleKey, boolean> | null>(
    initialModules ? toRecord(initialModules) : null,
  );
  const [draft, setDraft] = React.useState<Record<ModuleKey, boolean> | null>(saved);
  const [saving, setSaving] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(
    initialModules ? null : "Impossible de charger les modules de cette organisation.",
  );
  const idPrefix = React.useId();

  const dirty = Boolean(saved && draft && MODULES.some((module) => saved[module.key] !== draft[module.key]));
  const enabledCount = draft ? MODULES.filter((module) => draft[module.key]).length : 0;

  async function reload() {
    setLoadError(null);
    try {
      const response = await fetch(`/api/organizations/${organizationId}/modules`, { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as { modules?: ModuleState[]; message?: string };
      if (!response.ok || !body.modules) throw new Error(body.message ?? "Impossible de charger les modules.");
      const record = toRecord(body.modules);
      setSaved(record);
      setDraft(record);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Impossible de charger les modules.");
    }
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const modules = Object.fromEntries(
        MODULES.filter((module) => !module.essential).map((module) => [module.key, draft[module.key]]),
      );
      const response = await fetch(`/api/organizations/${organizationId}/modules`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modules }),
      });
      const body = (await response.json().catch(() => ({}))) as { modules?: ModuleState[]; message?: string };
      if (!response.ok || !body.modules) throw new Error(body.message ?? "Impossible d'enregistrer les modules.");
      const record = toRecord(body.modules);
      setSaved(record);
      setDraft(record);
      toast.success("Modules enregistrés pour cette organisation.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible d'enregistrer les modules.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]" data-testid="organization-modules">
      <CardContent className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h2 className="font-heading text-lg font-semibold text-foreground">Modules autorisés</h2>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Un module désactivé disparaît du menu et ses pages et API sont refusées par le serveur, pour cette
              organisation uniquement. Ses données sont conservées. Les administrateurs ne peuvent pas le réactiver.
            </p>
          </div>
          {draft ? (
            <p className="shrink-0 text-sm text-muted-foreground" aria-live="polite">
              {enabledCount} / {MODULES.length} activés{dirty ? " · modifications non enregistrées" : ""}
            </p>
          ) : null}
        </div>

        {loadError || !draft ? (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <span>{loadError ?? "Chargement des modules…"}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void reload()}>
              Réessayer
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            {GROUPS.map((group) => (
              <section key={group} className="space-y-2">
                <h3 className="text-[11px] font-semibold tracking-[0.22em] text-muted-foreground uppercase">{group}</h3>
                <ul className="divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/70 bg-white/70">
                  {MODULES.filter((module) => module.group === group).map((module) => {
                    const inputId = `${idPrefix}-${module.key}`;
                    const enabled = module.essential ? true : draft[module.key];
                    return (
                      <li key={module.key} className="flex items-start justify-between gap-4 px-4 py-3">
                        <div className="min-w-0 space-y-1">
                          <label htmlFor={inputId} className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                            {module.label}
                            {module.essential ? (
                              <Badge variant="outline" className="h-6 gap-1 px-2 text-[0.65rem]">
                                <Lock aria-hidden="true" />
                                Essentiel
                              </Badge>
                            ) : null}
                            {saved && !module.essential && saved[module.key] !== draft[module.key] ? (
                              <Badge variant="secondary" className="h-6 px-2 text-[0.65rem]">
                                Modifié
                              </Badge>
                            ) : null}
                          </label>
                          <p className="text-xs text-muted-foreground">{module.description}</p>
                          <p className="text-[11px] text-muted-foreground/90">
                            Utilisé par : {module.usedBy.map((role) => roleLabels[role]).join(", ")}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2 pt-0.5">
                          <span
                            className={`text-xs font-medium ${enabled ? "text-emerald-700" : "text-muted-foreground"}`}
                            aria-hidden="true"
                          >
                            {enabled ? "Activé" : "Désactivé"}
                          </span>
                          <Switch
                            id={inputId}
                            checked={enabled}
                            disabled={module.essential || saving}
                            aria-label={`${module.label} : ${enabled ? "activé" : "désactivé"}`}
                            onCheckedChange={(checked) =>
                              setDraft((current) => (current ? { ...current, [module.key]: checked } : current))
                            }
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={!dirty || saving}
                onClick={() => setDraft(saved)}
              >
                <RotateCcw aria-hidden="true" className="h-4 w-4" />
                Annuler les modifications
              </Button>
              <Button type="button" disabled={!dirty || saving} onClick={() => void save()}>
                {saving ? "Enregistrement…" : "Enregistrer les modules"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
