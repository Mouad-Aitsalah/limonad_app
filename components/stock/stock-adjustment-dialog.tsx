"use client";

import * as React from "react";
import { SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import type {
  StockAdjustmentInput,
  StockLevelDto,
  StockLocationDto,
} from "@/types/operations-dto";
import type { ProductDto } from "@/types/product-dto";

type StockAdjustmentDialogProps = {
  products: ProductDto[];
  locations: StockLocationDto[];
  onAdjusted: (level: StockLevelDto) => void;
};

const defaultValues: StockAdjustmentInput = {
  productId: "",
  locationId: "",
  quantity: 0,
  reason: "",
  note: "",
  reference: "",
  createdByUserId: "user-admin",
};

export function StockAdjustmentDialog({
  products,
  locations,
  onAdjusted,
}: StockAdjustmentDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [values, setValues] = React.useState(defaultValues);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);

  function update<K extends keyof StockAdjustmentInput>(
    key: K,
    value: StockAdjustmentInput[K],
  ) {
    setErrors((current) => ({ ...current, [key]: "" }));
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const response = await fetch("/api/stock/adjustments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    const payload = (await response.json()) as {
      level?: StockLevelDto;
      message?: string;
      fieldErrors?: Record<string, string>;
    };
    setSaving(false);

    if (!response.ok || !payload.level) {
      setErrors(payload.fieldErrors ?? { form: payload.message ?? "Erreur inconnue." });
      return;
    }

    onAdjusted(payload.level);
    setValues(defaultValues);
    setErrors({});
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="outline" />}>
        <SlidersHorizontal aria-hidden="true" />
        Ajustement manuel
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ajustement manuel de stock</DialogTitle>
          <DialogDescription>
            Cree un mouvement immuable INVENTORY_ADJUSTMENT.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {errors.form && <p className="text-sm text-destructive">{errors.form}</p>}
          <Field label="Produit" error={errors.productId}>
            <Select value={values.productId || null} onValueChange={(value) => update("productId", value ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selectionner un produit">
                  {(value: string | null) =>
                    products.find((product) => product.id === value)?.name ??
                    "Selectionner un produit"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {products.map((product) => (
                  <SelectItem key={product.id} value={product.id}>
                    {product.reference} - {product.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Emplacement" error={errors.locationId}>
            <Select value={values.locationId || null} onValueChange={(value) => update("locationId", value ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selectionner un emplacement">
                  {(value: string | null) =>
                    locations.find((location) => location.id === value)?.name ??
                    "Selectionner un emplacement"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {locations.map((location) => (
                  <SelectItem key={location.id} value={location.id}>
                    {location.code} - {location.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Quantite (+ entree / - sortie)" error={errors.quantity}>
            <Input
              type="number"
              value={values.quantity}
              onChange={(event) => update("quantity", Number(event.target.value))}
            />
          </Field>
          <Field label="Motif" error={errors.reason}>
            <Input
              value={values.reason}
              onChange={(event) => update("reason", event.target.value)}
              placeholder="Inventaire, casse, correction..."
            />
          </Field>
          <Field label="Reference" error={errors.reference}>
            <Input
              value={values.reference ?? ""}
              onChange={(event) => update("reference", event.target.value)}
              placeholder="Optionnel"
            />
          </Field>
          <Field label="Note" error={errors.note}>
            <Textarea
              value={values.note ?? ""}
              onChange={(event) => update("note", event.target.value)}
              placeholder="Optionnel"
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Ajustement..." : "Valider"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
