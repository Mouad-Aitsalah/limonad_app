"use client";

import * as React from "react";
import { toast } from "sonner";

import { CustomerLocationPicker } from "@/components/comptes/customer-location-picker";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { AccountingAccountOptionDto } from "@/types/accounting";
import type {
  BusinessAccountInput,
  BusinessAccountListItem,
  BusinessAccountType,
} from "@/types/business-account";

type AccountFormValues = {
  type: BusinessAccountType;
  code: string;
  name: string;
  phone: string;
  email: string;
  city: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  creditLimit: string;
  balance: string;
  status: "ACTIVE" | "INACTIVE" | "BLOCKED";
  ice: string;
  taxId: string;
  description: string;
  category: string;
  treasuryKind: "CASH" | "BANK";
  accountingAccountId: string;
};

const defaultValues: AccountFormValues = {
  type: "CUSTOMER",
  code: "",
  name: "",
  phone: "",
  email: "",
  city: "",
  address: "",
  latitude: null,
  longitude: null,
  creditLimit: "0",
  balance: "0",
  status: "ACTIVE",
  ice: "",
  taxId: "",
  description: "",
  category: "",
  treasuryKind: "CASH",
  accountingAccountId: "",
};

type AccountFormProps = {
  account?: BusinessAccountListItem | null;
  accountingAccounts: AccountingAccountOptionDto[];
  onCancel: () => void;
  onSaved: () => Promise<void> | void;
};

export function AccountForm({
  account,
  accountingAccounts,
  onCancel,
  onSaved,
}: AccountFormProps) {
  const [values, setValues] = React.useState<AccountFormValues>(() =>
    buildInitialValues(account),
  );
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);

  const selectableAccountingAccounts = React.useMemo(() => {
    if (values.type === "EXPENSE") {
      return accountingAccounts.filter((accountOption) => accountOption.type === "EXPENSE");
    }
    if (values.type === "TREASURY") {
      return accountingAccounts.filter((accountOption) =>
        ["TREASURY", "ASSET"].includes(accountOption.type),
      );
    }
    return accountingAccounts;
  }, [accountingAccounts, values.type]);

  const customerParentAccount = accountingAccounts.find(
    (accountOption) => accountOption.type === "RECEIVABLE",
  );
  const supplierParentAccount = accountingAccounts.find(
    (accountOption) => accountOption.type === "PAYABLE",
  );
  const accountNumberIsAutomatic =
    values.type === "CUSTOMER" || values.type === "SUPPLIER";

  function handleChange<K extends keyof AccountFormValues>(
    field: K,
    value: AccountFormValues[K],
  ) {
    setValues((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (!current[field]) {
        return current;
      }

      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFieldErrors({});

    const payload: BusinessAccountInput = {
      type: values.type,
      code: accountNumberIsAutomatic ? null : values.code || null,
      name: values.name,
      phone: values.phone || null,
      email: values.email || null,
      city: values.city || null,
      address: values.address || null,
      latitude: values.latitude,
      longitude: values.longitude,
      creditLimit: Number(values.creditLimit || 0),
      balance: Number(values.balance || 0),
      status: values.status,
      ice: values.ice || null,
      taxId: values.taxId || null,
      description: values.description || null,
      category: values.category || null,
      treasuryKind: values.type === "TREASURY" ? values.treasuryKind : null,
      accountingAccountId:
        values.type === "EXPENSE" || values.type === "TREASURY"
          ? values.accountingAccountId || null
          : null,
    };

    try {
      const response = await fetch(account ? `/api/comptes/${account.id}` : "/api/comptes", {
        method: account ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as {
        message?: string;
        fieldErrors?: Record<string, string>;
      };

      if (!response.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        throw new Error(
          result.message ??
            (account ? "Impossible de modifier le compte." : "Impossible de creer le compte."),
        );
      }

      toast.success(account ? "Compte modifie." : "Compte cree.");
      await onSaved();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : account
            ? "Impossible de modifier le compte."
            : "Impossible de creer le compte.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
        <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type de compte" error={fieldErrors.type}>
          <Select
            value={values.type}
            onValueChange={(value) => handleChange("type", value as BusinessAccountType)}
            disabled={Boolean(account)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selectionner">
                {() => typeLabels[values.type]}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="CUSTOMER">Client</SelectItem>
              <SelectItem value="SUPPLIER">Fournisseur</SelectItem>
              <SelectItem value="EXPENSE">Charge</SelectItem>
              <SelectItem value="TREASURY">Tresorerie</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        {accountNumberIsAutomatic ? (
          <ReadOnlyInfo
            label="N° compte"
            value={account ? values.code : automaticCodeHints[values.type]}
          />
        ) : (
          <Field label="N° compte" error={fieldErrors.code}>
            <Input
              value={values.code}
              onChange={(event) => handleChange("code", event.target.value)}
              placeholder={codePlaceholders[values.type]}
              disabled={Boolean(account)}
            />
          </Field>
        )}

        <Field label="Nom" error={fieldErrors.name}>
          <Input
            value={values.name}
            onChange={(event) => handleChange("name", event.target.value)}
            placeholder="Nom du compte"
          />
        </Field>

        <Field label="Statut" error={fieldErrors.status}>
          <Select
            value={values.status}
            onValueChange={(value) =>
              handleChange("status", value as AccountFormValues["status"])
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Statut">
                {() => statusLabels[values.status]}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ACTIVE">Actif</SelectItem>
              <SelectItem value="INACTIVE">Inactif</SelectItem>
              {values.type === "CUSTOMER" ? (
                <SelectItem value="BLOCKED">Bloque</SelectItem>
              ) : null}
            </SelectContent>
          </Select>
        </Field>

        {values.type === "CUSTOMER" || values.type === "SUPPLIER" ? (
          <>
            <Field label="Telephone" error={fieldErrors.phone}>
              <Input
                value={values.phone}
                onChange={(event) => handleChange("phone", event.target.value)}
                placeholder="+212..."
              />
            </Field>

            <Field label="Email" error={fieldErrors.email}>
              <Input
                type="email"
                value={values.email}
                onChange={(event) => handleChange("email", event.target.value)}
                placeholder="contact@exemple.com"
              />
            </Field>

            <Field label="Ville" error={fieldErrors.city}>
              <Input
                value={values.city}
                onChange={(event) => handleChange("city", event.target.value)}
                placeholder="Casablanca"
              />
            </Field>

            <Field label="Adresse" error={fieldErrors.address}>
              <Input
                value={values.address}
                onChange={(event) => handleChange("address", event.target.value)}
                placeholder="Adresse"
              />
            </Field>
          </>
        ) : null}

        {values.type === "CUSTOMER" ? (
          <CustomerLocationPicker
            customerName={values.name}
            latitude={values.latitude}
            longitude={values.longitude}
            onChange={({ latitude, longitude }) => {
              handleChange("latitude", latitude);
              handleChange("longitude", longitude);
            }}
          />
        ) : null}

        {values.type === "CUSTOMER" ? (
          <>
            <Field label="Limite de credit" error={fieldErrors.creditLimit}>
              <Input
                type="number"
                min={0}
                value={values.creditLimit}
                onChange={(event) => handleChange("creditLimit", event.target.value)}
              />
            </Field>

            <Field label="Solde initial" error={fieldErrors.balance}>
              <Input
                type="number"
                min={0}
                value={values.balance}
                onChange={(event) => handleChange("balance", event.target.value)}
                disabled={Boolean(account)}
              />
            </Field>

            <ReadOnlyInfo
              label="Compte comptable parent"
              value={
                customerParentAccount
                  ? `${customerParentAccount.code} - ${customerParentAccount.name}`
                  : "Compte client non configure"
              }
            />
          </>
        ) : null}

        {values.type === "SUPPLIER" ? (
          <>
            <Field label="ICE" error={fieldErrors.ice}>
              <Input
                value={values.ice}
                onChange={(event) => handleChange("ice", event.target.value)}
                placeholder="ICE"
              />
            </Field>

            <Field label="Identifiant fiscal" error={fieldErrors.taxId}>
              <Input
                value={values.taxId}
                onChange={(event) => handleChange("taxId", event.target.value)}
                placeholder="IF"
              />
            </Field>

            <ReadOnlyInfo
              label="Compte comptable parent"
              value={
                supplierParentAccount
                  ? `${supplierParentAccount.code} - ${supplierParentAccount.name}`
                  : "Compte fournisseur non configure"
              }
            />
          </>
        ) : null}

        {values.type === "EXPENSE" ? (
          <>
            <Field label="Categorie" error={fieldErrors.category}>
              <Input
                value={values.category}
                onChange={(event) => handleChange("category", event.target.value)}
                placeholder="Carburant"
              />
            </Field>

            <Field label="Solde" error={fieldErrors.balance}>
              <Input
                type="number"
                min={0}
                value={values.balance}
                onChange={(event) => handleChange("balance", event.target.value)}
              />
            </Field>

            <Field label="Compte comptable lie" error={fieldErrors.accountingAccountId}>
              <Select
                value={values.accountingAccountId || "none"}
                onValueChange={(value) =>
                  handleChange(
                    "accountingAccountId",
                    value === "none" ? "" : (value ?? ""),
                  )
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Optionnel">
                    {() =>
                      values.accountingAccountId
                        ? optionLabel(selectableAccountingAccounts, values.accountingAccountId) ??
                          "Optionnel"
                        : "Optionnel"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Aucun</SelectItem>
                  {selectableAccountingAccounts.map((accountOption) => (
                    <SelectItem key={accountOption.id} value={accountOption.id}>
                      {accountOption.code} - {accountOption.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <div className="sm:col-span-2">
              <Field label="Description" error={fieldErrors.description}>
                <Textarea
                  value={values.description}
                  onChange={(event) => handleChange("description", event.target.value)}
                  placeholder="Description de la charge"
                />
              </Field>
            </div>
          </>
        ) : null}

        {values.type === "TREASURY" ? (
          <>
            <Field label="Type de tresorerie" error={fieldErrors.treasuryKind}>
              <Select
                value={values.treasuryKind}
                onValueChange={(value) =>
                  handleChange("treasuryKind", value as AccountFormValues["treasuryKind"])
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selectionner">
                    {() => treasuryKindLabels[values.treasuryKind]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASH">Caisse</SelectItem>
                  <SelectItem value="BANK">Banque</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field label="Solde" error={fieldErrors.balance}>
              <Input
                type="number"
                min={0}
                value={values.balance}
                onChange={(event) => handleChange("balance", event.target.value)}
              />
            </Field>

            <Field label="Compte comptable lie" error={fieldErrors.accountingAccountId}>
              <Select
                value={values.accountingAccountId || "none"}
                onValueChange={(value) =>
                  handleChange(
                    "accountingAccountId",
                    value === "none" ? "" : (value ?? ""),
                  )
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Optionnel">
                    {() =>
                      values.accountingAccountId
                        ? optionLabel(selectableAccountingAccounts, values.accountingAccountId) ??
                          "Optionnel"
                        : "Optionnel"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Aucun</SelectItem>
                  {selectableAccountingAccounts.map((accountOption) => (
                    <SelectItem key={accountOption.id} value={accountOption.id}>
                      {accountOption.code} - {accountOption.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </>
        ) : null}
        </div>
      </div>

      <DialogFooter className="shrink-0">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Annuler
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Enregistrement..." : "Enregistrer"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function ReadOnlyInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-2 sm:col-span-2">
      <Label>{label}</Label>
      <div className="rounded-lg border border-input bg-muted px-3 py-2 text-sm text-muted-foreground">
        {value}
      </div>
    </div>
  );
}

function optionLabel(options: AccountingAccountOptionDto[], id: string) {
  const option = options.find((item) => item.id === id);
  return option ? `${option.code} - ${option.name}` : null;
}

function buildInitialValues(account?: BusinessAccountListItem | null): AccountFormValues {
  if (!account) {
    return defaultValues;
  }

  return {
    type: resolveEditableAccountType(account.type),
    code: account.accountNumber,
    name: account.name,
    phone: account.phone ?? "",
    email: account.email ?? "",
    city: account.city ?? "",
    address: account.address ?? "",
    latitude: account.latitude ?? null,
    longitude: account.longitude ?? null,
    creditLimit: account.type === "CUSTOMER" ? String(account.creditLimit ?? 0) : "0",
    balance: "0",
    status: account.status,
    ice: "",
    taxId: "",
    description: "",
    category: "",
    treasuryKind: "CASH",
    accountingAccountId: "",
  };
}

function resolveEditableAccountType(type: BusinessAccountListItem["type"]): BusinessAccountType {
  switch (type) {
    case "CUSTOMER":
    case "SUPPLIER":
    case "EXPENSE":
    case "TREASURY":
      return type;
    case "EMPLOYEE":
      return "EXPENSE";
    default:
      return "CUSTOMER";
  }
}

const typeLabels: Record<BusinessAccountType, string> = {
  CUSTOMER: "Client",
  SUPPLIER: "Fournisseur",
  EXPENSE: "Charge",
  TREASURY: "Tresorerie",
};

const statusLabels: Record<AccountFormValues["status"], string> = {
  ACTIVE: "Actif",
  INACTIVE: "Inactif",
  BLOCKED: "Bloque",
};

const treasuryKindLabels: Record<AccountFormValues["treasuryKind"], string> = {
  CASH: "Caisse",
  BANK: "Banque",
};

const codePlaceholders: Record<BusinessAccountType, string> = {
  CUSTOMER: "34211",
  SUPPLIER: "44111",
  EXPENSE: "CHG-0001",
  TREASURY: "TRE-0001",
};

const automaticCodeHints: Record<BusinessAccountType, string> = {
  CUSTOMER: "Genere automatiquement a partir de la sequence client 3421.",
  SUPPLIER: "Genere automatiquement a partir de la sequence fournisseur 4411.",
  EXPENSE: "",
  TREASURY: "",
};
