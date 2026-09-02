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
import type { DepotDto } from "@/types/operations-dto";
import type { CreatableUserRole, User, UserCreateInput } from "@/types/user";

// Base UI's Select needs a non-empty sentinel for "no selection".
const NO_DEPOT = "__none__";

// Roles that operate depot-scoped screens (POS, versements) and therefore
// must be tied to a depot. "admin" may use them too but is often org-wide,
// so a depot is offered but not required there. "driver" is scoped through
// Truck/Driver, not Depot.
const DEPOT_REQUIRED_ROLES: CreatableUserRole[] = ["cashier", "depot_manager"];
const DEPOT_APPLICABLE_ROLES: CreatableUserRole[] = ["admin", "cashier", "depot_manager"];

type UserFormValues = {
  nom: string;
  email: string;
  telephone: string;
  password: string;
  confirmPassword: string;
  role: CreatableUserRole;
  actif: boolean;
  depotId: string;
};

const defaultValues: UserFormValues = {
  nom: "",
  email: "",
  telephone: "",
  password: "",
  confirmPassword: "",
  role: "cashier",
  actif: true,
  depotId: NO_DEPOT,
};

type FormErrors = Partial<
  Record<
    "nom" | "email" | "telephone" | "password" | "confirmPassword" | "role" | "depotId" | "form",
    string
  >
>;

function validateClientSide(values: UserFormValues): FormErrors {
  const errors: FormErrors = {};

  if (values.nom.trim().length === 0) {
    errors.nom = "Le nom est obligatoire.";
  }
  if (values.email.trim().length === 0) {
    errors.email = "L'email est obligatoire.";
  }
  if (
    DEPOT_REQUIRED_ROLES.includes(values.role) &&
    (values.depotId === NO_DEPOT || values.depotId.length === 0)
  ) {
    errors.depotId = "Sélectionnez le dépôt de cet utilisateur.";
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
  const [depots, setDepots] = React.useState<DepotDto[]>([]);
  const [loadingDepots, setLoadingDepots] = React.useState(true);
  // Synchronous guard against a double-click racing two POSTs before React's
  // disabled state re-renders (same pattern used across COMDIS's other
  // creation forms - Inventaire, écritures, versements).
  const savingRef = React.useRef(false);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/depots?active=true")
      .then((response) => response.json())
      .then((data: { depots?: DepotDto[] }) => {
        if (!cancelled) setDepots((data.depots ?? []).filter((depot) => depot.active));
      })
      .catch(() => {
        if (!cancelled) setDepots([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingDepots(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleChange<K extends keyof UserFormValues>(
    field: K,
    value: UserFormValues[K],
  ) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  const showDepotField = DEPOT_APPLICABLE_ROLES.includes(values.role);
  const depotRequired = DEPOT_REQUIRED_ROLES.includes(values.role);

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
      depotId:
        showDepotField && values.depotId !== NO_DEPOT && values.depotId.length > 0
          ? values.depotId
          : null,
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

        {showDepotField && (
          <div className="space-y-2 sm:col-span-2">
            <Label>
              Dépôt
              {depotRequired ? null : (
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  (optionnel)
                </span>
              )}
            </Label>
            <Select
              value={values.depotId}
              onValueChange={(value) => value && handleChange("depotId", value)}
              disabled={loadingDepots}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Sélectionner">
                  {(value: string | null) =>
                    !value || value === NO_DEPOT
                      ? "Aucun dépôt"
                      : (depots.find((depot) => depot.id === value)?.name ?? "Sélectionner")
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {!depotRequired && <SelectItem value={NO_DEPOT}>Aucun dépôt</SelectItem>}
                {depots.map((depot) => (
                  <SelectItem key={depot.id} value={depot.id}>
                    {depot.name} — {depot.city}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Requis pour le point de vente et les versements.
            </p>
            {errors.depotId && (
              <p className="text-xs text-destructive">{errors.depotId}</p>
            )}
          </div>
        )}
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
