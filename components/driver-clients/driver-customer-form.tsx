"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  CustomerLocationSection,
  type CustomerLocationValue,
} from "@/components/driver-clients/customer-location-section";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CustomerDto, CustomerMutationInput } from "@/types/operations-dto";

export const driverCustomerTypes = [
  ["GROCERY", "Epicerie"],
  ["CAFE", "Cafe"],
  ["RESTAURANT", "Restaurant"],
  ["SUPERMARKET", "Supermarche"],
  ["WHOLESALER", "Grossiste"],
  ["COUNTER", "Client comptoir"],
  ["OTHER", "Autre"],
] as const;

type FormValues = {
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  type: string;
  ice: string;
  taxId: string;
  contactName: string;
  creditLimit: string;
  notes: string;
};

type DriverCustomerFormProps = {
  customer?: CustomerDto | null;
  /** Opens with the location section scrolled into view - the "Mettre a jour la localisation" entry point. */
  focusLocation?: boolean;
  onCancel: () => void;
  onSave: (input: CustomerMutationInput, id?: string) => Promise<Record<string, string> | null>;
};

/**
 * The real, backend-wired "Ajouter/Modifier client" form for the driver
 * space (/driver/clients). Posts through the existing driver customer
 * mutation (see DriverClientsView.saveCustomer -> POST /api/driver/customers
 * -> createCustomerForCurrentDriver) - no second client route.
 */
export function DriverCustomerForm({
  customer,
  focusLocation = false,
  onCancel,
  onSave,
}: DriverCustomerFormProps) {
  const [values, setValues] = React.useState<FormValues>(() => toFormValues(customer));
  const [location, setLocation] = React.useState<CustomerLocationValue>(() =>
    toLocationValue(customer),
  );
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  // Synchronous guard against a double-tap racing two POSTs before React's
  // disabled state re-renders (same pattern as the other COMDIS forms).
  const savingRef = React.useRef(false);
  const locationSectionRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (focusLocation) {
      locationSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    // Fires once per mount - the parent remounts this form with a fresh key
    // whenever focusLocation's intent changes, so this never needs to react
    // to focusLocation flipping in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;

    savingRef.current = true;
    setSaving(true);
    try {
      const input: CustomerMutationInput = {
        name: values.name.trim(),
        phone: values.phone.trim(),
        email: values.email.trim() || null,
        address: values.address.trim(),
        city: values.city.trim(),
        type: values.type,
        creditLimit: Number(values.creditLimit) || 0,
        ice: values.ice.trim() || null,
        taxId: values.taxId.trim() || null,
        contactName: values.contactName.trim() || null,
        notes: values.notes.trim() || null,
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null,
        locationAccuracy: location?.accuracy ?? null,
      };
      setErrors((await onSave(input, customer?.id)) ?? {});
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
      <CardContent>
        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
          <Field label="Nom" error={errors.name}>
            <Input value={values.name} onChange={(event) => update("name", event.target.value)} required />
          </Field>
          <Field label="Telephone" error={errors.phone}>
            <Input
              value={values.phone}
              onChange={(event) => update("phone", event.target.value)}
              required
            />
          </Field>
          <Field label="Adresse" error={errors.address}>
            <Input
              value={values.address}
              onChange={(event) => update("address", event.target.value)}
              required
            />
          </Field>
          <Field label="Ville" error={errors.city}>
            <Input value={values.city} onChange={(event) => update("city", event.target.value)} required />
          </Field>
          <Field label="Type">
            <select
              value={values.type}
              onChange={(event) => update("type", event.target.value)}
              className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
            >
              {driverCustomerTypes.map(([type, label]) => (
                <option key={type} value={type}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Email" error={errors.email}>
            <Input
              type="email"
              value={values.email}
              onChange={(event) => update("email", event.target.value)}
            />
          </Field>
          <Field label="ICE">
            <Input value={values.ice} onChange={(event) => update("ice", event.target.value)} />
          </Field>
          <Field label="Identifiant fiscal">
            <Input value={values.taxId} onChange={(event) => update("taxId", event.target.value)} />
          </Field>
          <Field label="Contact principal">
            <Input
              value={values.contactName}
              onChange={(event) => update("contactName", event.target.value)}
            />
          </Field>
          <Field label="Plafond credit">
            <Input
              type="number"
              min={0}
              value={values.creditLimit}
              onChange={(event) => update("creditLimit", event.target.value)}
            />
          </Field>

          <div ref={locationSectionRef} className="md:col-span-2">
            <CustomerLocationSection value={location} onChange={setLocation} />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label>Notes</Label>
            <Input value={values.notes} onChange={(event) => update("notes", event.target.value)} />
          </div>

          {errors.form && <p className="text-sm text-destructive md:col-span-2">{errors.form}</p>}

          <div className="flex flex-col-reverse gap-2 md:col-span-2 sm:flex-row">
            <Button type="submit" disabled={saving} className="h-12 rounded-2xl sm:w-auto">
              {saving ? "Enregistrement..." : customer ? "Enregistrer les modifications" : "Ajouter le client"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={saving}
              className="h-12 rounded-2xl sm:w-auto"
            >
              Annuler
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
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
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function toFormValues(customer?: CustomerDto | null): FormValues {
  return {
    name: customer?.name ?? "",
    phone: customer?.phone ?? "",
    email: customer?.email ?? "",
    address: customer?.address ?? "",
    city: customer?.city ?? "",
    type: customer?.type ?? "GROCERY",
    ice: customer?.ice ?? "",
    taxId: customer?.taxId ?? "",
    contactName: customer?.contactName ?? "",
    creditLimit: String(customer?.creditLimit ?? 0),
    notes: customer?.notes ?? "",
  };
}

function toLocationValue(customer?: CustomerDto | null): CustomerLocationValue {
  if (!customer || customer.latitude == null || customer.longitude == null) {
    return null;
  }
  return {
    latitude: customer.latitude,
    longitude: customer.longitude,
    accuracy: customer.locationAccuracy ?? null,
  };
}
