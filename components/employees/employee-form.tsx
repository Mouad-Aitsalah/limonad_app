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
import type { EmployeeDto, EmployeeInput, EmployeeStatus } from "@/types/employees";

type EmployeeFormValues = {
  employeeCode: string;
  fullName: string;
  hireDate: string;
  salary: string;
  phone: string;
  advanceAccountCode: string;
  salaryAccountCode: string;
  status: EmployeeStatus;
};

const defaultValues: EmployeeFormValues = {
  employeeCode: "",
  fullName: "",
  hireDate: "",
  salary: "",
  phone: "",
  advanceAccountCode: "",
  salaryAccountCode: "",
  status: "ACTIVE",
};

type EmployeeFormProps = {
  employee?: EmployeeDto | null;
  onCancel: () => void;
  onSaved: () => Promise<void> | void;
};

export function EmployeeForm({ employee, onCancel, onSaved }: EmployeeFormProps) {
  const [values, setValues] = React.useState<EmployeeFormValues>(() =>
    buildInitialValues(employee),
  );
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const advanceAccountName = buildEmployeeAdvanceAccountName(
    values.fullName,
    values.advanceAccountCode,
  );
  const salaryAccountName = buildEmployeeSalaryAccountName(
    values.fullName,
    values.salaryAccountCode,
  );

  function handleChange<K extends keyof EmployeeFormValues>(
    field: K,
    value: EmployeeFormValues[K],
  ) {
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

    const payload: EmployeeInput = {
      employeeCode: values.employeeCode,
      fullName: values.fullName,
      hireDate: values.hireDate || null,
      salary: values.salary.length > 0 ? Number(values.salary) : null,
      phone: values.phone || null,
      advanceAccountCode: values.advanceAccountCode,
      salaryAccountCode: values.salaryAccountCode,
      status: values.status,
    };

    try {
      const response = await fetch(employee ? `/api/employees/${employee.id}` : "/api/employees", {
        method: employee ? "PATCH" : "POST",
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
            (employee ? "Impossible de modifier l'employe." : "Impossible de creer l'employe."),
        );
      }

      toast.success(employee ? "Employe modifie." : "Employe cree.");
      await onSaved();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : employee
            ? "Impossible de modifier l'employe."
            : "Impossible de creer l'employe.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {fieldErrors.form ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {fieldErrors.form}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code employe *" error={fieldErrors.employeeCode}>
          <Input
            value={values.employeeCode}
            onChange={(event) => handleChange("employeeCode", event.target.value)}
            placeholder="LBASHIR"
          />
        </Field>

        <Field label="Nom complet *" error={fieldErrors.fullName}>
          <Input
            value={values.fullName}
            onChange={(event) => handleChange("fullName", event.target.value)}
            placeholder="Lbashir"
          />
        </Field>

        <Field label="Date d'embauche" error={fieldErrors.hireDate}>
          <Input
            type="date"
            value={values.hireDate}
            onChange={(event) => handleChange("hireDate", event.target.value)}
          />
        </Field>

        <Field label="Salaire mensuel *" error={fieldErrors.salary}>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={values.salary}
            onChange={(event) => handleChange("salary", event.target.value)}
            placeholder="1800"
          />
        </Field>

        <Field label="Telephone" error={fieldErrors.phone}>
          <Input
            value={values.phone}
            onChange={(event) => handleChange("phone", event.target.value)}
            placeholder="+212..."
          />
        </Field>

        <Field label="Statut" error={fieldErrors.status}>
          <Select
            value={values.status}
            onValueChange={(value) => handleChange("status", value as EmployeeStatus)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Statut" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ACTIVE">Actif</SelectItem>
              <SelectItem value="INACTIVE">Inactif</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field label="Compte avance *" error={fieldErrors.advanceAccountCode}>
          <div className="space-y-2">
            <Input
              type="text"
              value={values.advanceAccountCode}
              onChange={(event) => handleChange("advanceAccountCode", event.target.value)}
              placeholder="34315"
            />
            <GeneratedAccountName
              value={advanceAccountName}
              emptyLabel="Le nom sera genere automatiquement apres saisie du nom complet et du code compte."
            />
          </div>
        </Field>

        <Field label="Compte salaire *" error={fieldErrors.salaryAccountCode}>
          <div className="space-y-2">
            <Input
              type="text"
              value={values.salaryAccountCode}
              onChange={(event) => handleChange("salaryAccountCode", event.target.value)}
              placeholder="44325"
            />
            <GeneratedAccountName
              value={salaryAccountName}
              emptyLabel="Le nom sera genere automatiquement apres saisie du nom complet et du code compte."
            />
          </div>
        </Field>
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

function GeneratedAccountName({
  value,
  emptyLabel,
}: {
  value: string | null;
  emptyLabel: string;
}) {
  return (
    <p className="text-xs text-muted-foreground">
      <span className="font-medium text-foreground">Nom genere :</span>{" "}
      {value ?? emptyLabel}
    </p>
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

function buildInitialValues(employee?: EmployeeDto | null): EmployeeFormValues {
  if (!employee) return defaultValues;

  return {
    employeeCode: employee.employeeCode,
    fullName: employee.fullName,
    hireDate: employee.hireDate ? employee.hireDate.slice(0, 10) : "",
    salary: employee.salary != null ? String(employee.salary) : "",
    phone: employee.phone ?? "",
    advanceAccountCode: employee.advanceAccount?.code ?? "",
    salaryAccountCode: employee.salaryAccount?.code ?? "",
    status: employee.status,
  };
}

function buildEmployeeAdvanceAccountName(fullName: string, code: string) {
  if (!fullName.trim() || !code.trim()) return null;
  return `Avances et acomptes au personnel ${fullName.trim()}`;
}

function buildEmployeeSalaryAccountName(fullName: string, code: string) {
  if (!fullName.trim() || !code.trim()) return null;
  return `Rémunération due au personnel ${fullName.trim()}`;
}
