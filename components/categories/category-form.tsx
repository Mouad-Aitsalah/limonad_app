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
import type { CategoryListItem, CategoryMutationInput } from "@/types/category";

type CategoryFormValues = {
  code: string;
  name: string;
  active: boolean;
};

type CategoryFormProps = {
  category?: CategoryListItem | null;
  readOnly?: boolean;
  onCancel: () => void;
  onSaved: (values: CategoryMutationInput) => Promise<Record<string, string> | null>;
};

export function CategoryForm({
  category,
  readOnly = false,
  onCancel,
  onSaved,
}: CategoryFormProps) {
  const [values, setValues] = React.useState<CategoryFormValues>(() => ({
    code: category?.code ?? "",
    name: category?.name ?? "",
    active: category?.active ?? true,
  }));
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = React.useState(false);

  function handleChange<K extends keyof CategoryFormValues>(
    field: K,
    value: CategoryFormValues[K],
  ) {
    setValues((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: "" }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly) return;

    setIsSaving(true);
    const errors = await onSaved({
      code: values.code || null,
      name: values.name,
      active: values.active,
    });
    setFieldErrors(errors ?? {});
    setIsSaving(false);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 space-y-5 overflow-y-auto px-1 py-1">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="categoryCode">Réf catégorie</Label>
            <Input
              id="categoryCode"
              value={values.code}
              disabled={readOnly}
              onChange={(event) => handleChange("code", event.target.value)}
              placeholder="CAT-001"
            />
            <p className="text-xs text-muted-foreground">
              Laissez vide pour une génération automatique côté serveur.
            </p>
            <FieldError message={fieldErrors.code} />
          </div>

          <div className="space-y-2">
            <Label>Statut</Label>
            <Select
              value={values.active ? "ACTIVE" : "INACTIVE"}
              onValueChange={(value) => handleChange("active", value === "ACTIVE")}
              disabled={readOnly}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Sélectionner">
                  {() => (values.active ? "Actif" : "Inactif")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTIVE">Actif</SelectItem>
                <SelectItem value="INACTIVE">Inactif</SelectItem>
              </SelectContent>
            </Select>
            <FieldError message={fieldErrors.active} />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="categoryName">Désignation catégorie</Label>
            <Input
              id="categoryName"
              value={values.name}
              disabled={readOnly}
              onChange={(event) => handleChange("name", event.target.value)}
              placeholder="Chaussures"
            />
            <FieldError message={fieldErrors.name} />
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {readOnly ? "Fermer" : "Annuler"}
        </Button>
        {!readOnly ? (
          <Button type="submit" disabled={isSaving}>
            {isSaving ? "Enregistrement..." : "Enregistrer"}
          </Button>
        ) : null}
      </DialogFooter>
    </form>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}
