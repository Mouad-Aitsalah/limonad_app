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
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { roleLabels, roleOptions } from "@/lib/roles";
import type { CreatableUserRole, User, UserCreateInput } from "@/types/user";

type UserFormValues = {
  nom: string;
  email: string;
  telephone: string;
  password: string;
  confirmPassword: string;
  role: CreatableUserRole;
  actif: boolean;
};

const defaultValues: UserFormValues = {
  nom: "",
  email: "",
  telephone: "",
  password: "",
  confirmPassword: "",
  role: "cashier",
  actif: true,
};

type FormErrors = Partial<
  Record<"nom" | "email" | "telephone" | "password" | "confirmPassword" | "role" | "form", string>
>;

function validateClientSide(values: UserFormValues): FormErrors {
  const errors: FormErrors = {};

  if (values.nom.trim().length === 0) {
    errors.nom = "Le nom est obligatoire.";
  }
  if (values.email.trim().length === 0) {
    errors.email = "L'email est obligatoire.";
  }
  // Mirrors lib/server/password-policy.ts's rule for a responsive UI - the
  // server remains the sole authority (this is a client component, it
  // cannot import that server-only module) and re-validates independently
  // on submit regardless of what this check does.
  const hasMinLength = values.password.length >= 10;
  const hasLetter = /[A-Za-z]/.test(values.password);
  const hasDigit = /[0-9]/.test(values.password);
  if (!hasMinLength || !hasLetter || !hasDigit) {
    errors.password =
      "Le mot de passe doit contenir au moins 10 caractères, dont une lettre et un chiffre.";
  }
  if (values.confirmPassword !== values.password) {
    errors.confirmPassword = "La confirmation ne correspond pas au mot de passe.";
  }

  return errors;
}

type UserFormProps = {
  onCancel: () => void;
  onSaved: (user: User) => void;
};

export function UserForm({ onCancel, onSaved }: UserFormProps) {
  const [values, setValues] = React.useState<UserFormValues>(defaultValues);
  const [errors, setErrors] = React.useState<FormErrors>({});
  const [saving, setSaving] = React.useState(false);
  // Synchronous guard against a double-click racing two POSTs before React's
  // disabled state re-renders (same pattern used across COMDIS's other
  // creation forms - Inventaire, écritures, versements).
  const savingRef = React.useRef(false);

  function handleChange<K extends keyof UserFormValues>(
    field: K,
    value: UserFormValues[K],
  ) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;

    const validationErrors = validateClientSide(values);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    const payload: UserCreateInput = {
      nom: values.nom.trim(),
      email: values.email.trim(),
      telephone: values.telephone.trim() || null,
      password: values.password,
      role: values.role,
      actif: values.actif,
    };

    savingRef.current = true;
    setSaving(true);
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as {
        user?: User;
        message?: string;
        fieldErrors?: Record<string, string>;
      };

      if (!response.ok || !result.user) {
        setErrors((result.fieldErrors as FormErrors) ?? {});
        toast.error(result.message ?? "Impossible de creer l'utilisateur.");
        return;
      }

      toast.success(`Utilisateur ${result.user.nom} cree.`);
      onSaved(result.user);
    } catch {
      toast.error("Impossible de creer l'utilisateur.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-1 flex-col overflow-hidden"
    >
      <div className="flex-1 space-y-5 overflow-y-auto px-1 py-1">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Général</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="nom">Nom complet</Label>
            <Input
              id="nom"
              value={values.nom}
              onChange={(event) => handleChange("nom", event.target.value)}
              placeholder="Nadia Squalli"
              aria-invalid={!!errors.nom}
            />
            {errors.nom && (
              <p className="text-xs text-destructive">{errors.nom}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={values.email}
              onChange={(event) => handleChange("email", event.target.value)}
              placeholder="prenom.nom@comdis.local"
              aria-invalid={!!errors.email}
            />
            {errors.email && (
              <p className="text-xs text-destructive">{errors.email}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="telephone">Téléphone</Label>
            <Input
              id="telephone"
              value={values.telephone}
              onChange={(event) => handleChange("telephone", event.target.value)}
              placeholder="+212 6 00-000000"
              aria-invalid={!!errors.telephone}
            />
            {errors.telephone && (
              <p className="text-xs text-destructive">{errors.telephone}</p>
            )}
          </div>
        </div>
      </div>

      <Separator />

      <div>
        <h3 className="text-sm font-semibold text-foreground">
          Authentification
        </h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="password">Mot de passe</Label>
            <Input
              id="password"
              type="password"
              value={values.password}
              onChange={(event) => handleChange("password", event.target.value)}
              autoComplete="new-password"
              aria-invalid={!!errors.password}
            />
            {errors.password && (
              <p className="text-xs text-destructive">{errors.password}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirmation</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={values.confirmPassword}
              onChange={(event) =>
                handleChange("confirmPassword", event.target.value)
              }
              autoComplete="new-password"
              aria-invalid={!!errors.confirmPassword}
            />
            {errors.confirmPassword && (
              <p className="text-xs text-destructive">
                {errors.confirmPassword}
              </p>
            )}
          </div>
        </div>
      </div>

      <Separator />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Rôle</Label>
          <Select
            value={values.role}
            onValueChange={(value) =>
              value && handleChange("role", value as CreatableUserRole)
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Sélectionner">
                {() => roleLabels[values.role]}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {roleOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.role && (
            <p className="text-xs text-destructive">{errors.role}</p>
          )}
        </div>

        <div className="flex items-center justify-between rounded-xl border border-border p-3">
          <div>
            <p className="text-sm font-medium text-foreground">Actif</p>
            <p className="text-xs text-muted-foreground">
              Autorisé à se connecter
            </p>
          </div>
          <Switch
            checked={values.actif}
            onCheckedChange={(checked) => handleChange("actif", checked)}
          />
        </div>
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
