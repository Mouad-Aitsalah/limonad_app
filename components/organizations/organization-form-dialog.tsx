"use client";

import * as React from "react";
import { Building2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  OrganizationDetailDto,
  OrganizationSummaryDto,
  OrganizationUpdateInput,
} from "@/types/organization";

type OrganizationFormDialogProps = {
  initialOrganization?: OrganizationSummaryDto | OrganizationDetailDto;
  triggerLabel?: string;
  triggerVariant?: "default" | "outline";
  onSaved?: (organization: OrganizationDetailDto) => void;
};

type FieldErrors = Record<string, string>;

export function OrganizationFormDialog({
  initialOrganization,
  triggerLabel,
  triggerVariant = "default",
  onSaved,
}: OrganizationFormDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});

  const editing = Boolean(initialOrganization);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    setFieldErrors({});

    const body = editing
      ? buildUpdatePayload(formData)
      : buildCreatePayload(formData);

    try {
      const response = await fetch(
        editing ? `/api/organizations/${initialOrganization?.id}` : "/api/organizations",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const payload = (await response.json()) as {
        organization?: OrganizationDetailDto;
        message?: string;
        fieldErrors?: FieldErrors;
      };

      if (!response.ok || !payload.organization) {
        setFieldErrors(payload.fieldErrors ?? {});
        toast.error(
          payload.message ??
            (editing
              ? "Impossible de mettre a jour l'organisation."
              : "Impossible de creer l'organisation."),
        );
        return;
      }

      onSaved?.(payload.organization);
      setOpen(false);
      toast.success(
        editing
          ? "Organisation mise a jour avec succes."
          : "Organisation creee avec succes.",
      );
    } catch {
      toast.error(
        editing
          ? "Impossible de mettre a jour l'organisation."
          : "Impossible de creer l'organisation.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" variant={triggerVariant} size="lg" className="w-full sm:w-auto" />
        }
      >
        {editing ? <Building2 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        {triggerLabel ?? (editing ? "Modifier organisation" : "Nouvelle organisation")}
      </DialogTrigger>

      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {editing ? "Modifier l'organisation" : "Nouvelle organisation"}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? "Mettez a jour les informations globales de cette entreprise."
              : "Creez une entreprise vide avec son admin principal et ses parametres techniques de base."}
          </DialogDescription>
        </DialogHeader>

        <form action={handleSubmit} className="grid gap-4 md:grid-cols-2">
          <Field label="Nom organisation" name="name" error={fieldErrors.name} defaultValue={initialOrganization?.name} required />
          <Field label="Code organisation" name="code" error={fieldErrors.code} defaultValue={initialOrganization?.code} required />
          <Field label="Nom commercial" name="tradeName" error={fieldErrors.tradeName} defaultValue={initialOrganization?.tradeName ?? ""} />
          <Field label="Telephone" name="phone" error={fieldErrors.phone} defaultValue={initialOrganization?.phone ?? ""} />
          <Field label="Email" name="email" type="email" error={fieldErrors.email} defaultValue={initialOrganization?.email ?? ""} />
          <Field label="Ville" name="city" error={fieldErrors.city} defaultValue={initialOrganization?.city ?? ""} />
          <Field label="Pays" name="country" error={fieldErrors.country} defaultValue={initialOrganization?.country ?? ""} />
          <Field label="Adresse" name="address" error={fieldErrors.address} defaultValue={initialOrganization?.address ?? ""} />
          <div className="space-y-2">
            <Label htmlFor="status">Statut</Label>
            <select
              id="status"
              name="status"
              defaultValue={initialOrganization?.status ?? "ACTIVE"}
              className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
            >
              <option value="ACTIVE">ACTIVE</option>
              <option value="INACTIVE">INACTIVE</option>
            </select>
          </div>

          {!editing ? (
            <>
              <div className="md:col-span-2">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Admin principal
                </p>
              </div>
              <Field label="Nom admin" name="adminName" error={fieldErrors.adminName} required />
              <Field label="Email admin" name="adminEmail" type="email" error={fieldErrors.adminEmail} required />
              <Field
                label="Mot de passe initial"
                name="adminPassword"
                type="password"
                error={fieldErrors.adminPassword}
                required
              />
            </>
          ) : null}

          {fieldErrors.form ? (
            <p className="text-sm text-destructive md:col-span-2">{fieldErrors.form}</p>
          ) : null}

          <div className="flex gap-2 md:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Enregistrement..." : editing ? "Enregistrer" : "Creer l'organisation"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Annuler
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  name,
  error,
  defaultValue,
  type = "text",
  required = false,
}: {
  label: string;
  name: string;
  error?: string;
  defaultValue?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} defaultValue={defaultValue} required={required} />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function buildCreatePayload(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    code: String(formData.get("code") ?? ""),
    tradeName: String(formData.get("tradeName") ?? "") || null,
    address: String(formData.get("address") ?? "") || null,
    phone: String(formData.get("phone") ?? "") || null,
    email: String(formData.get("email") ?? "") || null,
    city: String(formData.get("city") ?? "") || null,
    country: String(formData.get("country") ?? "") || null,
    status: String(formData.get("status") ?? "ACTIVE"),
    adminName: String(formData.get("adminName") ?? ""),
    adminEmail: String(formData.get("adminEmail") ?? ""),
    adminPassword: String(formData.get("adminPassword") ?? ""),
  };
}

function buildUpdatePayload(formData: FormData): OrganizationUpdateInput {
  return {
    name: String(formData.get("name") ?? ""),
    code: String(formData.get("code") ?? ""),
    tradeName: String(formData.get("tradeName") ?? "") || null,
    address: String(formData.get("address") ?? "") || null,
    phone: String(formData.get("phone") ?? "") || null,
    email: String(formData.get("email") ?? "") || null,
    city: String(formData.get("city") ?? "") || null,
    country: String(formData.get("country") ?? "") || null,
    status: (String(formData.get("status") ?? "ACTIVE") as "ACTIVE" | "INACTIVE"),
  };
}
