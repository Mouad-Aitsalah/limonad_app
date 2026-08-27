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
import { users } from "@/lib/mock-data/users";
import type { UserRole } from "@/types/auth";

type UserFormValues = {
  nom: string;
  email: string;
  telephone: string;
  password: string;
  confirmPassword: string;
  role: UserRole;
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
  Record<"nom" | "email" | "password" | "confirmPassword", string>
>;

function validate(values: UserFormValues): FormErrors {
  const errors: FormErrors = {};

  if (values.nom.trim().length === 0) {
    errors.nom = "Le nom est obligatoire.";
  }

  if (values.email.trim().length === 0) {
    errors.email = "L'email est obligatoire.";
  } else if (
    users.some(
      (user) => user.email.toLowerCase() === values.email.trim().toLowerCase(),
    )
  ) {
    errors.email = "Cet email est déjà utilisé par un autre utilisateur.";
  }

  if (values.password.length < 6) {
    errors.password = "Le mot de passe doit contenir au moins 6 caractères.";
  }

  if (values.confirmPassword !== values.password) {
    errors.confirmPassword = "La confirmation ne correspond pas au mot de passe.";
  }

  return errors;
}

type UserFormProps = {
  onCancel: () => void;
  onSaved: () => void;
};

export function UserForm({ onCancel, onSaved }: UserFormProps) {
  const [values, setValues] = React.useState<UserFormValues>(defaultValues);
  const [errors, setErrors] = React.useState<FormErrors>({});

  function handleChange<K extends keyof UserFormValues>(
    field: K,
    value: UserFormValues[K],
  ) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const validationErrors = validate(values);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    toast.success("Utilisateur créé (simulation)");
    onSaved();
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
            />
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
              value && handleChange("role", value as UserRole)
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
        <Button type="button" variant="outline" onClick={onCancel}>
          Annuler
        </Button>
        <Button type="submit">Enregistrer</Button>
      </DialogFooter>
    </form>
  );
}
