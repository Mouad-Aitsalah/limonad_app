"use client";

import * as React from "react";

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
import { truckStatusConfig, type TruckStatusValue } from "@/components/trucks/truck-status-badge";
import type { DepotDto, TruckDto, TruckMutationInput } from "@/types/operations-dto";

const defaultValues: TruckMutationInput = {
  code: "",
  registration: "",
  brand: "",
  model: "",
  capacity: null,
  status: "AVAILABLE",
  depotId: "",
};

type TruckFormProps = {
  truck?: TruckDto | null;
  depots: DepotDto[];
  readOnly: boolean;
  onCancel: () => void;
  onSaved: (values: TruckMutationInput) => Promise<Record<string, string> | null>;
};

export function TruckForm({
  truck,
  depots,
  readOnly,
  onCancel,
  onSaved,
}: TruckFormProps) {
  const [values, setValues] = React.useState<TruckMutationInput>(() =>
    truckToValues(truck, depots[0]?.id ?? ""),
  );
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);

  function handleChange<K extends keyof TruckMutationInput>(
    field: K,
    value: TruckMutationInput[K],
  ) {
    setErrors((current) => ({ ...current, [field]: "" }));
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly) return;
    setSaving(true);
    const fieldErrors = await onSaved(values);
    setErrors(fieldErrors ?? {});
    setSaving(false);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 space-y-5 overflow-y-auto px-1 py-1">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Code" error={errors.code}>
            <Input
              value={values.code}
              disabled={readOnly}
              onChange={(event) => handleChange("code", event.target.value)}
              placeholder="CAM-07"
            />
          </Field>
          <Field label="Immatriculation" error={errors.registration}>
            <Input
              value={values.registration}
              disabled={readOnly}
              onChange={(event) => handleChange("registration", event.target.value)}
              placeholder="12345-A-6"
            />
          </Field>
          <Field label="Marque" error={errors.brand}>
            <Input
              value={values.brand ?? ""}
              disabled={readOnly}
              onChange={(event) => handleChange("brand", event.target.value)}
              placeholder="Isuzu"
            />
          </Field>
          <Field label="Modele" error={errors.model}>
            <Input
              value={values.model ?? ""}
              disabled={readOnly}
              onChange={(event) => handleChange("model", event.target.value)}
              placeholder="NPR 75"
            />
          </Field>
          <Field label="Capacite" error={errors.capacity}>
            <Input
              type="number"
              min={0}
              value={values.capacity ?? ""}
              disabled={readOnly}
              onChange={(event) =>
                handleChange(
                  "capacity",
                  event.target.value ? Number(event.target.value) : null,
                )
              }
            />
          </Field>
          <Field label="Depot" error={errors.depotId}>
            <Select
              value={values.depotId}
              disabled={readOnly}
              onValueChange={(value) => handleChange("depotId", value ?? "")}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selectionner">
                  {(value: string | null) =>
                    depots.find((depot) => depot.id === value)?.name ?? "Selectionner"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {depots.map((depot) => (
                  <SelectItem key={depot.id} value={depot.id}>
                    {depot.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Statut" error={errors.status}>
            <Select
              value={values.status}
              disabled={readOnly}
              onValueChange={(value) => handleChange("status", value ?? "AVAILABLE")}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Statut">
                  {(value: string | null) =>
                    truckStatusConfig[value as TruckStatusValue]?.label ?? "Statut"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(truckStatusConfig) as TruckStatusValue[]).map((status) => (
                  <SelectItem key={status} value={status}>
                    {truckStatusConfig[status].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {readOnly ? "Fermer" : "Annuler"}
        </Button>
        {!readOnly && (
          <Button type="submit" disabled={saving}>
            {saving ? "Enregistrement..." : "Enregistrer"}
          </Button>
        )}
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
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function truckToValues(truck: TruckDto | null | undefined, defaultDepotId: string) {
  if (!truck) {
    return { ...defaultValues, depotId: defaultDepotId };
  }
  return {
    code: truck.code,
    registration: truck.registration,
    brand: truck.brand ?? "",
    model: truck.model ?? "",
    capacity: truck.capacity,
    status: truck.status,
    depotId: truck.depot.id,
  };
}
