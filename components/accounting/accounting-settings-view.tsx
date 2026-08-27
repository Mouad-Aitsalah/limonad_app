"use client";

import * as React from "react";
import { toast } from "sonner";

import {
  accountingSettingsFieldDefinitions,
  accountingStampCalculationMethodLabels,
} from "@/lib/accounting";
import type {
  AccountingAccountSettingsKey,
  AccountingAccountOptionDto,
  AccountingSettingsDto,
  AccountingSettingsUpdateInput,
} from "@/types/accounting";
import { Button } from "@/components/ui/button";

type AccountingSettingsViewProps = {
  initialSettings: AccountingSettingsDto;
  accounts: AccountingAccountOptionDto[];
  canManage: boolean;
};

export function AccountingSettingsView({
  initialSettings,
  accounts,
  canManage,
}: AccountingSettingsViewProps) {
  const [settings, setSettings] = React.useState(initialSettings);
  const [draft, setDraft] = React.useState<AccountingSettingsUpdateInput>({
    employeePayrollExpenseAccountId: initialSettings.employeePayrollExpenseAccountId,
    salesAccountId: initialSettings.salesAccountId,
    salesVatAccountId: initialSettings.salesVatAccountId,
    purchaseAccountId: initialSettings.purchaseAccountId,
    purchaseVatAccountId: initialSettings.purchaseVatAccountId,
    cashAccountId: initialSettings.cashAccountId,
    bankAccountId: initialSettings.bankAccountId,
    customerAccountId: initialSettings.customerAccountId,
    supplierAccountId: initialSettings.supplierAccountId,
    customerReturnAccountId: initialSettings.customerReturnAccountId,
    supplierReturnAccountId: initialSettings.supplierReturnAccountId,
    stampEnabled: initialSettings.stampEnabled,
    stampCalculationMethod: initialSettings.stampCalculationMethod,
    stampValue: initialSettings.stampValue,
    stampExpenseAccountId: initialSettings.stampExpenseAccountId,
    stampPayableAccountId: initialSettings.stampPayableAccountId,
  });
  const [saving, setSaving] = React.useState(false);

  async function handleSave() {
    if (!canManage) return;
    setSaving(true);
    try {
      const response = await fetch("/api/accounting/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const result = (await response.json()) as {
        settings?: AccountingSettingsDto;
        message?: string;
      };
      if (!response.ok || !result.settings) {
        toast.error(result.message ?? "Impossible de sauvegarder les parametres.");
        return;
      }
      setSettings(result.settings);
      setDraft({
        employeePayrollExpenseAccountId: result.settings.employeePayrollExpenseAccountId,
        salesAccountId: result.settings.salesAccountId,
        salesVatAccountId: result.settings.salesVatAccountId,
        purchaseAccountId: result.settings.purchaseAccountId,
        purchaseVatAccountId: result.settings.purchaseVatAccountId,
        cashAccountId: result.settings.cashAccountId,
        bankAccountId: result.settings.bankAccountId,
        customerAccountId: result.settings.customerAccountId,
        supplierAccountId: result.settings.supplierAccountId,
        customerReturnAccountId: result.settings.customerReturnAccountId,
        supplierReturnAccountId: result.settings.supplierReturnAccountId,
        stampEnabled: result.settings.stampEnabled,
        stampCalculationMethod: result.settings.stampCalculationMethod,
        stampValue: result.settings.stampValue,
        stampExpenseAccountId: result.settings.stampExpenseAccountId,
        stampPayableAccountId: result.settings.stampPayableAccountId,
      });
      toast.success("Parametres comptables mis a jour.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {!canManage && (
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          Vous avez un acces en lecture seule aux parametres comptables.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {accountingSettingsFieldDefinitions.map((field) => (
          <div
            key={field.key}
            className="rounded-xl border border-border bg-card p-4 shadow-[0_10px_30px_rgba(15,23,42,0.06)]"
          >
            <div className="mb-3">
              <h3 className="font-medium text-foreground">{field.label}</h3>
              <p className="text-sm text-muted-foreground">{field.hint}</p>
            </div>
            <select
              value={getAccountDraftValue(draft, field.key)}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  [field.key]: event.target.value || null,
                }))
              }
              disabled={!canManage}
              className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="">Aucun compte</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} - {account.name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card p-4 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
        <div className="mb-4">
          <h3 className="font-medium text-foreground">Timbre</h3>
          <p className="text-sm text-muted-foreground">
            Configure le calcul du timbre sur les nouvelles ventes. Le timbre reste
            comptabilise a part et n&apos;est pas ajoute automatiquement au reglement.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Activer le timbre</label>
            <select
              value={draft.stampEnabled ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  stampEnabled: event.target.value === "true",
                }))
              }
              disabled={!canManage}
              className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="false">Non</option>
              <option value="true">Oui</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Type de calcul</label>
            <select
              value={draft.stampCalculationMethod ?? "FIXED_AMOUNT"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  stampCalculationMethod: event.target.value as AccountingSettingsDto["stampCalculationMethod"],
                }))
              }
              disabled={!canManage}
              className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
            >
              {Object.entries(accountingStampCalculationMethodLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Valeur</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={draft.stampValue ?? 0}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  stampValue: Number(event.target.value || 0),
                }))
              }
              disabled={!canManage}
              className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
            />
            <p className="text-xs text-muted-foreground">
              Montant fixe ou pourcentage du total TTC selon le type choisi.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-4 shadow-[0_10px_30px_rgba(15,23,42,0.06)] sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted-foreground">
          Derniere mise a jour :
          {" "}
          {new Date(settings.updatedAt).toLocaleDateString("fr-FR")}
          {settings.updatedByUserName ? ` par ${settings.updatedByUserName}` : ""}
        </div>
        {canManage && (
          <Button type="button" size="lg" onClick={handleSave} disabled={saving}>
            {saving ? "Enregistrement..." : "Enregistrer les parametres"}
          </Button>
        )}
      </div>
    </div>
  );
}

function getAccountDraftValue(
  draft: AccountingSettingsUpdateInput,
  key: AccountingAccountSettingsKey,
) {
  return draft[key] ?? "";
}
