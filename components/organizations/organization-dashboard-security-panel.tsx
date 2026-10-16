"use client";

import * as React from "react";
import { KeyRound, RotateCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  DASHBOARD_RENEWAL_PERIOD_OPTIONS,
  isDashboardRenewalPeriod,
  type DashboardRenewalPeriod,
  type OrganizationDashboardSecurityDto,
} from "@/lib/dashboard-security";

type OrganizationDashboardSecurityPanelProps = {
  organizationId: string;
  /** Server-loaded state; null when it could not be loaded (the panel then offers a retry). */
  initialSecurity: OrganizationDashboardSecurityDto | null;
};

type Draft = { enabled: boolean; renewalEnabled: boolean; renewalPeriod: DashboardRenewalPeriod };

function toDraft(security: OrganizationDashboardSecurityDto): Draft {
  return { enabled: security.enabled, renewalEnabled: security.renewalEnabled, renewalPeriod: security.renewalPeriod };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}

function statusBadge(security: OrganizationDashboardSecurityDto) {
  if (!security.enabled) return { label: "Désactivée", className: "border-border text-muted-foreground" };
  if (security.state === "creation_required") return { label: "Mot de passe à créer", className: "border-amber-200 bg-amber-50 text-amber-800" };
  if (security.state === "renewal_required") return { label: "Renouvellement requis", className: "border-amber-200 bg-amber-50 text-amber-800" };
  return { label: "Active", className: "border-emerald-200 bg-emerald-50 text-emerald-700" };
}

async function readJson<T>(response: Response): Promise<T & { message?: string }> {
  return (await response.json().catch(() => ({}))) as T & { message?: string };
}

/**
 * SUPER_ADMIN: « Sécurité du dashboard » of one organisation. The switches edit a draft; « Enregistrer » sends
 * it (PUT /api/organizations/[id]/dashboard-security, SUPER_ADMIN only on the server). The dashboard password
 * itself is never shown - only whether one is set and when it must be renewed. « Réinitialiser le mot de
 * passe dashboard » asks a confirmation, then invalidates the password and every open authorization.
 */
export function OrganizationDashboardSecurityPanel({ organizationId, initialSecurity }: OrganizationDashboardSecurityPanelProps) {
  const [saved, setSaved] = React.useState<OrganizationDashboardSecurityDto | null>(initialSecurity);
  const [draft, setDraft] = React.useState<Draft | null>(initialSecurity ? toDraft(initialSecurity) : null);
  const [saving, setSaving] = React.useState(false);
  const [resetOpen, setResetOpen] = React.useState(false);
  const [resetting, setResetting] = React.useState(false);
  const [resetError, setResetError] = React.useState<string | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(
    initialSecurity ? null : "Impossible de charger la sécurité du dashboard.",
  );
  const idPrefix = React.useId();
  const endpoint = `/api/organizations/${organizationId}/dashboard-security`;

  const dirty = Boolean(
    saved &&
      draft &&
      (saved.enabled !== draft.enabled ||
        saved.renewalEnabled !== draft.renewalEnabled ||
        saved.renewalPeriod !== draft.renewalPeriod),
  );

  function apply(security: OrganizationDashboardSecurityDto) {
    setSaved(security);
    setDraft(toDraft(security));
  }

  async function reload() {
    setLoadError(null);
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const body = await readJson<Partial<OrganizationDashboardSecurityDto>>(response);
      if (!response.ok || body.enabled === undefined) throw new Error(body.message ?? "Impossible de charger la sécurité du dashboard.");
      apply(body as OrganizationDashboardSecurityDto);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Impossible de charger la sécurité du dashboard.");
    }
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const response = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = await readJson<Partial<OrganizationDashboardSecurityDto>>(response);
      if (!response.ok || body.enabled === undefined) throw new Error(body.message ?? "Impossible d'enregistrer la sécurité du dashboard.");
      apply(body as OrganizationDashboardSecurityDto);
      toast.success("Sécurité du dashboard enregistrée pour cette organisation.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible d'enregistrer la sécurité du dashboard.");
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setResetting(true);
    setResetError(null);
    try {
      const response = await fetch(`${endpoint}/reset`, { method: "POST" });
      const body = await readJson<Partial<OrganizationDashboardSecurityDto>>(response);
      if (!response.ok || body.enabled === undefined) throw new Error(body.message ?? "Impossible de réinitialiser le mot de passe dashboard.");
      // Only the server-side state changed: keep the unsaved switches the Super Admin may have touched.
      setSaved(body as OrganizationDashboardSecurityDto);
      setResetOpen(false);
      toast.success("Mot de passe dashboard réinitialisé. L'administrateur devra en créer un nouveau.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Impossible de réinitialiser le mot de passe dashboard.";
      setResetError(message);
      toast.error(message);
    } finally {
      setResetting(false);
    }
  }

  const badge = saved ? statusBadge(saved) : null;
  const enabledId = `${idPrefix}-enabled`;
  const renewalId = `${idPrefix}-renewal`;
  const periodId = `${idPrefix}-period`;

  return (
    <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]" data-testid="organization-dashboard-security">
      <CardContent className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h2 className="flex items-center gap-2 font-heading text-lg font-semibold text-foreground">
              <ShieldCheck aria-hidden="true" className="h-5 w-5 text-muted-foreground" />
              Sécurité du dashboard
            </h2>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Quand elle est activée, l&apos;administrateur de cette organisation définit un mot de passe dédié et le dashboard le
              demande à chaque visite. Le serveur refuse les données du dashboard tant qu&apos;il n&apos;est pas validé. Ce réglage ne
              concerne que cette organisation.
            </p>
          </div>
          {badge ? (
            <Badge variant="outline" className={`h-6 shrink-0 px-2 text-[0.7rem] ${badge.className}`} data-testid="dashboard-security-status">
              {badge.label}
            </Badge>
          ) : null}
        </div>

        {loadError || !draft || !saved ? (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <span>{loadError ?? "Chargement de la sécurité du dashboard…"}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void reload()}>
              Réessayer
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4 rounded-2xl border border-border/70 bg-white/70 px-4 py-3">
              <div className="min-w-0 space-y-1">
                <Label htmlFor={enabledId} className="text-sm font-medium text-foreground">
                  Activer la sécurité du dashboard
                </Label>
                <p className="text-xs text-muted-foreground">
                  Désactivée : le dashboard fonctionne exactement comme avant. Le mot de passe déjà créé n&apos;est pas supprimé.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2 pt-0.5">
                <span className={`text-xs font-medium ${draft.enabled ? "text-emerald-700" : "text-muted-foreground"}`} aria-hidden="true">
                  {draft.enabled ? "Activée" : "Désactivée"}
                </span>
                <Switch
                  id={enabledId}
                  checked={draft.enabled}
                  disabled={saving}
                  aria-label={`Sécurité du dashboard : ${draft.enabled ? "activée" : "désactivée"}`}
                  onCheckedChange={(checked) => setDraft((current) => (current ? { ...current, enabled: checked } : current))}
                />
              </div>
            </div>

            {draft.enabled ? (
              <div className="space-y-4" data-testid="dashboard-security-options">
                <div className="space-y-3 rounded-2xl border border-border/70 bg-white/70 px-4 py-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 space-y-1">
                      <Label htmlFor={renewalId} className="text-sm font-medium text-foreground">
                        Renouvellement périodique du mot de passe
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Désactivé : le mot de passe reste valable jusqu&apos;à sa réinitialisation. Activé : il expire à la fin de la
                        période et l&apos;administrateur doit en définir un nouveau.
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 pt-0.5">
                      <span className={`text-xs font-medium ${draft.renewalEnabled ? "text-emerald-700" : "text-muted-foreground"}`} aria-hidden="true">
                        {draft.renewalEnabled ? "Activé" : "Désactivé"}
                      </span>
                      <Switch
                        id={renewalId}
                        checked={draft.renewalEnabled}
                        disabled={saving}
                        aria-label={`Renouvellement périodique : ${draft.renewalEnabled ? "activé" : "désactivé"}`}
                        onCheckedChange={(checked) =>
                          setDraft((current) => (current ? { ...current, renewalEnabled: checked } : current))
                        }
                      />
                    </div>
                  </div>

                  {draft.renewalEnabled ? (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <Label htmlFor={periodId} className="text-sm text-foreground">
                        Période de renouvellement
                      </Label>
                      <select
                        id={periodId}
                        value={draft.renewalPeriod}
                        disabled={saving}
                        onChange={(event) => {
                          const value = event.target.value;
                          if (isDashboardRenewalPeriod(value)) {
                            setDraft((current) => (current ? { ...current, renewalPeriod: value } : current));
                          }
                        }}
                        className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-56"
                      >
                        {DASHBOARD_RENEWAL_PERIOD_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-white/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1 text-sm" data-testid="dashboard-security-password-state">
                    <p className="flex items-center gap-2 font-medium text-foreground">
                      <KeyRound aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                      {saved.passwordSet ? "Mot de passe dashboard défini" : "Aucun mot de passe dashboard défini"}
                    </p>
                    {saved.passwordSet && saved.passwordSetAt ? (
                      <p className="text-xs text-muted-foreground">Créé le {formatDate(saved.passwordSetAt)}.</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">L&apos;administrateur doit le créer à sa prochaine ouverture du dashboard.</p>
                    )}
                    {saved.passwordSet && saved.renewalEnabled && saved.passwordExpiresAt ? (
                      <p className="text-xs text-muted-foreground" data-testid="dashboard-security-next-renewal">
                        Prochain renouvellement : {formatDate(saved.passwordExpiresAt)}
                        {saved.state === "renewal_required" ? " (échu)" : ""}.
                      </p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-auto min-h-8 w-full whitespace-normal text-center sm:w-auto"
                    disabled={saving || resetting}
                    onClick={() => {
                      setResetError(null);
                      setResetOpen(true);
                    }}
                  >
                    <RotateCcw aria-hidden="true" className="h-4 w-4" />
                    Réinitialiser le mot de passe dashboard
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
              <Button type="button" variant="outline" className="w-full sm:w-auto" disabled={!dirty || saving} onClick={() => setDraft(saved ? toDraft(saved) : draft)}>
                <RotateCcw aria-hidden="true" className="h-4 w-4" />
                Annuler les modifications
              </Button>
              <Button type="button" className="w-full sm:w-auto" disabled={!dirty || saving} onClick={() => void save()}>
                {saving ? "Enregistrement…" : "Enregistrer la sécurité"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      <Dialog open={resetOpen} onOpenChange={(open) => (!resetting ? setResetOpen(open) : undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Réinitialiser le mot de passe dashboard ?</DialogTitle>
            <DialogDescription>
              L&apos;ancien mot de passe cesse de fonctionner immédiatement et toutes les autorisations déjà accordées sont
              annulées. L&apos;administrateur de l&apos;organisation devra créer un nouveau mot de passe à sa prochaine ouverture du
              dashboard.
            </DialogDescription>
          </DialogHeader>
          {resetError ? (
            <p role="alert" className="text-sm text-destructive">
              {resetError}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={resetting} onClick={() => setResetOpen(false)}>
              Annuler
            </Button>
            <Button type="button" variant="destructive" disabled={resetting} onClick={() => void reset()}>
              {resetting ? "Réinitialisation…" : "Réinitialiser"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
