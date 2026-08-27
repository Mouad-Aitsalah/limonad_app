"use client";

import * as React from "react";
import { toast } from "sonner";

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
import type { ContactDto, ContactInput, ContactStatus } from "@/types/contacts";
import type { SupplierPartnerDto } from "@/types/operations-dto";

type ContactFormValues = {
  reference: string;
  fullName: string;
  supplierId: string;
  phone1: string;
  phone2: string;
  email: string;
  address: string;
  notes: string;
  status: ContactStatus;
};

const defaultValues: ContactFormValues = {
  reference: "",
  fullName: "",
  supplierId: "",
  phone1: "",
  phone2: "",
  email: "",
  address: "",
  notes: "",
  status: "ACTIVE",
};

type ContactFormProps = {
  contact?: ContactDto | null;
  suppliers: SupplierPartnerDto[];
  onCancel: () => void;
  onSaved: () => Promise<void> | void;
};

export function ContactForm({ contact, suppliers, onCancel, onSaved }: ContactFormProps) {
  const [values, setValues] = React.useState<ContactFormValues>(() => buildInitialValues(contact));
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);

  function handleChange<K extends keyof ContactFormValues>(field: K, value: ContactFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFieldErrors({});

    const payload: ContactInput = {
      reference: values.reference,
      fullName: values.fullName,
      supplierId: values.supplierId || null,
      phone1: values.phone1 || null,
      phone2: values.phone2 || null,
      email: values.email || null,
      address: values.address || null,
      notes: values.notes || null,
      status: values.status,
    };

    try {
      const response = await fetch(contact ? `/api/contacts/${contact.id}` : "/api/contacts", {
        method: contact ? "PATCH" : "POST",
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
            (contact ? "Impossible de modifier le contact." : "Impossible de creer le contact."),
        );
      }

      toast.success(contact ? "Contact modifie." : "Contact cree.");
      await onSaved();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : contact
            ? "Impossible de modifier le contact."
            : "Impossible de creer le contact.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Reference contact *" error={fieldErrors.reference}>
          <Input
            value={values.reference}
            onChange={(event) => handleChange("reference", event.target.value)}
            placeholder="ATACADAO"
          />
        </Field>

        <Field label="Nom complet *" error={fieldErrors.fullName}>
          <Input
            value={values.fullName}
            onChange={(event) => handleChange("fullName", event.target.value)}
            placeholder="Nom complet"
          />
        </Field>

        <Field label="Telephone 1" error={fieldErrors.phone1}>
          <Input
            value={values.phone1}
            onChange={(event) => handleChange("phone1", event.target.value)}
            placeholder="0610 01 11 41"
          />
        </Field>

        <Field label="Telephone 2" error={fieldErrors.phone2}>
          <Input
            value={values.phone2}
            onChange={(event) => handleChange("phone2", event.target.value)}
            placeholder="0661 26 78 59"
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

        <Field label="Reference fournisseur" error={fieldErrors.supplierId}>
          <Select
            value={values.supplierId || "none"}
            onValueChange={(value) => handleChange("supplierId", value === "none" ? "" : (value ?? ""))}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Optionnel">
                {() =>
                  values.supplierId
                    ? optionLabel(suppliers, values.supplierId) ?? "Optionnel"
                    : "Optionnel"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Aucun</SelectItem>
              {suppliers.map((supplier) => (
                <SelectItem key={supplier.id} value={supplier.id}>
                  {supplier.code} - {supplier.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Statut" error={fieldErrors.status}>
          <Select
            value={values.status}
            onValueChange={(value) => handleChange("status", value as ContactStatus)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Statut">
                {() => (values.status === "ACTIVE" ? "Actif" : "Inactif")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ACTIVE">Actif</SelectItem>
              <SelectItem value="INACTIVE">Inactif</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <div className="sm:col-span-2">
          <Field label="Adresse" error={fieldErrors.address}>
            <Input
              value={values.address}
              onChange={(event) => handleChange("address", event.target.value)}
              placeholder="Adresse"
            />
          </Field>
        </div>

        <div className="sm:col-span-2">
          <Field label="Observation" error={fieldErrors.notes}>
            <Textarea
              value={values.notes}
              onChange={(event) => handleChange("notes", event.target.value)}
              placeholder="Remarque sur ce contact..."
            />
          </Field>
        </div>
      </div>

      <DialogFooter>
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

function optionLabel(suppliers: SupplierPartnerDto[], id: string) {
  const supplier = suppliers.find((item) => item.id === id);
  return supplier ? `${supplier.code} - ${supplier.name}` : null;
}

function buildInitialValues(contact?: ContactDto | null): ContactFormValues {
  if (!contact) return defaultValues;

  return {
    reference: contact.reference,
    fullName: contact.fullName,
    supplierId: contact.supplierId ?? "",
    phone1: contact.phone1 ?? "",
    phone2: contact.phone2 ?? "",
    email: contact.email ?? "",
    address: contact.address ?? "",
    notes: contact.notes ?? "",
    status: contact.status,
  };
}
