"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
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
import {
  customerStatusLabels,
  customerTypeLabels,
  generateNextCustomerCode,
} from "@/lib/customer-utils";
import type { Customer, CustomerStatus, CustomerType } from "@/types/customer";

type DriverClientFormProps = {
  customers: Customer[];
  driverId: string;
  driverName: string;
  truckId: string | null;
  tourId: string | null;
  customer?: Customer | null;
  onCancel: () => void;
  onSaved: (customer: Customer) => void;
};

type FormValues = {
  nom: string;
  telephone: string;
  adresse: string;
  ville: string;
  type: CustomerType | "";
  statut: CustomerStatus;
  email: string;
  ice: string;
  identifiantFiscal: string;
  contactPrincipal: string;
  plafondCredit: string;
  gps: string;
  notes: string;
};

type FormErrors = Partial<Record<keyof FormValues, string>>;

const customerTypes: CustomerType[] = [
  "epicerie",
  "cafe",
  "restaurant",
  "supermarche",
  "grossiste",
  "client_comptoir",
  "autre",
];

const statuses: CustomerStatus[] = ["actif", "inactif", "bloque"];

export function DriverClientForm({
  customers,
  driverId,
  driverName,
  truckId,
  tourId,
  customer,
  onCancel,
  onSaved,
}: DriverClientFormProps) {
  const isEdit = Boolean(customer);
  const nextCode = React.useMemo(
    () => customer?.code ?? generateNextCustomerCode(customers),
    [customer?.code, customers],
  );
  const [values, setValues] = React.useState<FormValues>(() => ({
    nom: customer?.nom ?? "",
    telephone: customer?.telephone ?? "",
    adresse: customer?.adresse ?? "",
    ville: customer?.ville ?? "",
    type: customer?.type ?? "",
    statut: customer?.statut ?? "actif",
    email: customer?.email ?? "",
    ice: customer?.ice ?? "",
    identifiantFiscal: customer?.identifiantFiscal ?? "",
    contactPrincipal: customer?.contactPrincipal ?? "",
    plafondCredit: String(customer?.plafondCredit ?? 0),
    gps: customer?.gps ?? "",
    notes: customer?.notes ?? "",
  }));

  const errors = React.useMemo(
    () => validate(values, customers, customer?.id ?? null),
    [values, customers, customer?.id],
  );
  const isValid = Object.keys(errors).length === 0;

  function update<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isValid || values.type === "") return;

    const now = new Date();
    onSaved({
      id: customer?.id ?? `client-driver-${now.getTime()}`,
      nom: values.nom.trim(),
      code: nextCode,
      telephone: values.telephone.trim(),
      adresse: values.adresse.trim(),
      ville: values.ville.trim(),
      type: values.type,
      statut: values.statut,
      email: optional(values.email),
      ice: optional(values.ice),
      identifiantFiscal: optional(values.identifiantFiscal),
      contactPrincipal: optional(values.contactPrincipal),
      plafondCredit: Number(values.plafondCredit),
      creditUtilise: customer?.creditUtilise ?? 0,
      gps: optional(values.gps),
      notes: optional(values.notes),
      createdByUserId: customer?.createdByUserId ?? driverId,
      createdByUserName: customer?.createdByUserName ?? driverName,
      createdByDriverId: customer?.createdByDriverId ?? driverId,
      createdFromTruckId: customer?.createdFromTruckId ?? truckId ?? undefined,
      createdFromTourId: customer?.createdFromTourId ?? tourId ?? undefined,
      creationOrigin: customer?.creationOrigin ?? "DRIVER",
      createdAt: customer?.createdAt ?? now,
      updatedAt: now,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex-1 space-y-5 overflow-y-auto px-1 py-1">
      <div className="grid gap-4 md:grid-cols-2">
        <ReadOnlyField label="Code client" value={nextCode} />
        <Field
          label="Nom ou raison sociale"
          error={errors.nom}
          input={
            <Input
              value={values.nom}
              onChange={(event) => update("nom", event.target.value)}
            />
          }
        />
        <Field
          label="Telephone"
          error={errors.telephone}
          input={
            <Input
              value={values.telephone}
              onChange={(event) => update("telephone", event.target.value)}
            />
          }
        />
        <Field
          label="Email"
          error={errors.email}
          input={
            <Input
              type="email"
              value={values.email}
              onChange={(event) => update("email", event.target.value)}
            />
          }
        />
        <Field
          label="Adresse"
          error={errors.adresse}
          input={
            <Input
              value={values.adresse}
              onChange={(event) => update("adresse", event.target.value)}
            />
          }
        />
        <Field
          label="Ville"
          error={errors.ville}
          input={
            <Input
              value={values.ville}
              onChange={(event) => update("ville", event.target.value)}
            />
          }
        />
        <Field
          label="Type de client"
          error={errors.type}
          input={
            <Select
              value={values.type}
              onValueChange={(value) => update("type", value as CustomerType)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selectionner un type">
                  {(value: CustomerType | null) =>
                    value ? customerTypeLabels[value] : "Selectionner un type"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {customerTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {customerTypeLabels[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <Field
          label="Statut"
          input={
            <Select
              value={values.statut}
              onValueChange={(value) => update("statut", value as CustomerStatus)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Statut">
                  {(value: CustomerStatus | null) =>
                    value ? customerStatusLabels[value] : "Statut"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {statuses.map((status) => (
                  <SelectItem key={status} value={status}>
                    {customerStatusLabels[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <Field
          label="ICE"
          input={
            <Input
              value={values.ice}
              onChange={(event) => update("ice", event.target.value)}
            />
          }
        />
        <Field
          label="Identifiant fiscal"
          input={
            <Input
              value={values.identifiantFiscal}
              onChange={(event) => update("identifiantFiscal", event.target.value)}
            />
          }
        />
        <Field
          label="Contact principal"
          input={
            <Input
              value={values.contactPrincipal}
              onChange={(event) => update("contactPrincipal", event.target.value)}
            />
          }
        />
        <Field
          label="Plafond de credit"
          error={errors.plafondCredit}
          input={
            <Input
              type="number"
              min={0}
              value={values.plafondCredit}
              onChange={(event) => update("plafondCredit", event.target.value)}
            />
          }
        />
        <Field
          label="Coordonnees GPS"
          input={
            <Input
              value={values.gps}
              onChange={(event) => update("gps", event.target.value)}
              placeholder="33.5731,-7.5898"
            />
          }
        />
      </div>

      <Field
        label="Notes"
        input={
          <Textarea
            value={values.notes}
            onChange={(event) => update("notes", event.target.value)}
          />
        }
      />

      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>
          Annuler
        </Button>
        <Button type="submit" disabled={!isValid}>
          {isEdit ? "Enregistrer les modifications" : "Ajouter le client"}
        </Button>
      </div>
    </form>
  );
}

function validate(
  values: FormValues,
  customers: Customer[],
  currentCustomerId: string | null,
): FormErrors {
  const errors: FormErrors = {};

  if (values.nom.trim().length === 0) errors.nom = "Le nom est obligatoire.";
  if (values.telephone.trim().length === 0) {
    errors.telephone = "Le telephone est obligatoire.";
  } else if (
    customers.some(
      (customer) =>
        customer.id !== currentCustomerId &&
        customer.telephone.trim() === values.telephone.trim(),
    )
  ) {
    errors.telephone = "Un client existe deja avec ce telephone.";
  }
  if (values.adresse.trim().length === 0) {
    errors.adresse = "L'adresse est obligatoire.";
  }
  if (values.ville.trim().length === 0) errors.ville = "La ville est obligatoire.";
  if (values.type === "") errors.type = "Le type de client est obligatoire.";
  if (Number(values.plafondCredit) < 0) {
    errors.plafondCredit = "Le plafond de credit ne peut pas etre negatif.";
  }
  if (
    values.email.trim().length > 0 &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())
  ) {
    errors.email = "L'adresse email n'est pas valide.";
  }

  return errors;
}

function optional(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function Field({
  label,
  input,
  error,
}: {
  label: string;
  input: React.ReactNode;
  error?: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {input}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex h-8 items-center rounded-lg border border-input bg-muted px-2.5 text-sm font-medium text-muted-foreground">
        {value}
      </div>
    </div>
  );
}
