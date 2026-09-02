"use client";

import * as React from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ProductCombobox } from "@/components/commerce/product-combobox";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { purchasePaymentMethods } from "@/lib/mock-data/purchase-payment-methods";
import {
  computeLineSousTotal,
  computePurchaseTotals,
} from "@/lib/purchase-calculations";
import { cn, formatCurrency } from "@/lib/utils";
import type { Purchase, PurchasePaymentMethod } from "@/types/purchase";
import type { ProductDto, ProductOptionDto } from "@/types/product-dto";

type LineDraft = {
  key: string;
  productId: string;
  // Phase 3 CRITICAL #1 fix: the full picked ProductDto, captured at
  // selection time (see ProductCombobox), kept alongside `productId` for
  // display - `productOptions` is now only a small bounded preload and may
  // no longer contain an already-selected product once the user has
  // searched past it. Mirrors StockAdjustmentDialog's `selectedProduct`.
  product: ProductDto | null;
  quantite: number;
  prixAchat: number;
  remisePercent: number;
};

function createLine(key: string, productOptions: ProductDto[]): LineDraft {
  const product = productOptions[0] ?? null;
  return {
    key,
    productId: product?.id ?? "",
    product,
    quantite: 1,
    prixAchat: product?.purchasePrice ?? 0,
    remisePercent: 0,
  };
}

type PurchaseFormValues = {
  date: string;
  fournisseurId: string;
  modeReglement: PurchasePaymentMethod;
  numeroCheque: string;
  banque: string;
  datePaiement: string;
  observation: string;
  lignes: LineDraft[];
};

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function buildDefaultValues(productOptions: ProductDto[]): PurchaseFormValues {
  return {
    date: todayInputValue(),
    fournisseurId: "",
    modeReglement: "especes",
    numeroCheque: "",
    banque: "",
    datePaiement: "",
    observation: "",
    lignes: [createLine("line-1", productOptions)],
  };
}

type FormErrors = {
  fournisseur?: string;
  numeroCheque?: string;
  lignesMessage?: string;
  invalidLineKeys: Record<string, boolean>;
};

function validate(values: PurchaseFormValues): FormErrors {
  const errors: FormErrors = { invalidLineKeys: {} };

  if (values.fournisseurId.trim().length === 0) {
    errors.fournisseur = "Le fournisseur est obligatoire.";
  }

  if (
    values.modeReglement === "cheque" &&
    values.numeroCheque.trim().length === 0
  ) {
    errors.numeroCheque = "Le numéro de chèque est obligatoire.";
  }

  if (values.lignes.length === 0) {
    errors.lignesMessage = "Ajoutez au moins un produit.";
  }

  let hasLineError = false;
  for (const line of values.lignes) {
    if (
      line.productId.trim().length === 0 ||
      line.quantite <= 0 ||
      line.prixAchat <= 0
    ) {
      errors.invalidLineKeys[line.key] = true;
      hasLineError = true;
    }
  }
  if (hasLineError && !errors.lignesMessage) {
    errors.lignesMessage =
      "Chaque ligne doit avoir une quantité et un prix supérieurs à 0.";
  }

  return errors;
}

function hasBlockingErrors(errors: FormErrors) {
  return (
    !!errors.fournisseur ||
    !!errors.numeroCheque ||
    !!errors.lignesMessage
  );
}

type PurchaseFormProps = {
  onCancel: () => void;
  supplierOptions: ProductOptionDto[];
  productOptions: ProductDto[];
  onSaved: (purchase: Omit<Purchase, "id" | "numero" | "createdAt" | "updatedAt">) => Promise<void>;
};

export function PurchaseForm({
  onCancel,
  onSaved,
  productOptions,
  supplierOptions,
}: PurchaseFormProps) {
  const { currentUser } = useAuth();
  const [values, setValues] = React.useState<PurchaseFormValues>(
    () => buildDefaultValues(productOptions),
  );
  const [errors, setErrors] = React.useState<FormErrors>({ invalidLineKeys: {} });
  const [submitting, setSubmitting] = React.useState(false);
  const lineKeyCounter = React.useRef(1);

  function handleChange<K extends keyof PurchaseFormValues>(
    field: K,
    value: PurchaseFormValues[K],
  ) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setValues((prev) => ({
      ...prev,
      lignes: prev.lignes.map((line) =>
        line.key === key ? { ...line, ...patch } : line,
      ),
    }));
  }

  function addLine() {
    lineKeyCounter.current += 1;
    setValues((prev) => ({
      ...prev,
      lignes: [
        ...prev.lignes,
        createLine(`line-${lineKeyCounter.current}`, productOptions),
      ],
    }));
  }

  function removeLine(key: string) {
    setValues((prev) => ({
      ...prev,
      lignes: prev.lignes.filter((line) => line.key !== key),
    }));
  }

  const totals = computePurchaseTotals(values.lignes);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const validationErrors = validate(values);
    setErrors(validationErrors);
    if (hasBlockingErrors(validationErrors)) return;

    setSubmitting(true);
    try {
      await onSaved({
        date: new Date(values.date),
        fournisseurId: values.fournisseurId,
        modeReglement: values.modeReglement,
        numeroCheque: values.modeReglement === "cheque" ? values.numeroCheque : null,
        banque: values.modeReglement === "cheque" ? values.banque : null,
        datePaiement: values.datePaiement ? new Date(values.datePaiement) : null,
        utilisateurId: currentUser?.id ?? "",
        observation: values.observation,
        statut: "validee",
        lignes: values.lignes.map((line) => ({
          productId: line.productId,
          quantite: line.quantite,
          prixAchat: line.prixAchat,
          remisePercent: line.remisePercent,
        })),
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Impossible d'enregistrer l'achat.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-1 flex-col overflow-hidden"
    >
      <div className="flex-1 space-y-6 overflow-y-auto px-1 py-1">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Informations générales
          </h3>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                type="date"
                value={values.date}
                onChange={(event) => handleChange("date", event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Fournisseur</Label>
              <Select
                value={values.fournisseurId || null}
                onValueChange={(value) =>
                  handleChange("fournisseurId", value ?? "")
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Sélectionner">
                    {() =>
                      supplierOptions.find(
                        (supplier) => supplier.id === values.fournisseurId,
                      )?.name ?? "Sélectionner"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {supplierOptions.map((supplier) => (
                    <SelectItem key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.fournisseur && (
                <p className="text-xs text-destructive">{errors.fournisseur}</p>
              )}
              {supplierOptions.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Aucun fournisseur actif disponible.
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label>Mode règlement</Label>
              <Select
                value={values.modeReglement}
                onValueChange={(value) =>
                  value &&
                  handleChange("modeReglement", value as PurchasePaymentMethod)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Sélectionner">
                    {() =>
                      purchasePaymentMethods.find(
                        (method) => method.value === values.modeReglement,
                      )?.label ?? "Sélectionner"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {purchasePaymentMethods.map((method) => (
                    <SelectItem key={method.value} value={method.value}>
                      {method.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {values.modeReglement === "cheque" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="numeroCheque">N° chèque</Label>
                  <Input
                    id="numeroCheque"
                    value={values.numeroCheque}
                    onChange={(event) =>
                      handleChange("numeroCheque", event.target.value)
                    }
                    placeholder="123456"
                    aria-invalid={!!errors.numeroCheque}
                  />
                  {errors.numeroCheque && (
                    <p className="text-xs text-destructive">
                      {errors.numeroCheque}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="banque">Banque</Label>
                  <Input
                    id="banque"
                    value={values.banque}
                    onChange={(event) =>
                      handleChange("banque", event.target.value)
                    }
                    placeholder="Attijariwafa Bank"
                  />
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="datePaiement">Date de paiement</Label>
              <Input
                id="datePaiement"
                type="date"
                value={values.datePaiement}
                onChange={(event) =>
                  handleChange("datePaiement", event.target.value)
                }
              />
            </div>

            <div className="space-y-2">
              <Label>Utilisateur</Label>
              <Input
                readOnly
                value={currentUser?.nom ?? ""}
                className="bg-muted text-muted-foreground"
              />
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <Label htmlFor="observation">Observation</Label>
            <Textarea
              id="observation"
              value={values.observation}
              onChange={(event) =>
                handleChange("observation", event.target.value)
              }
              placeholder="Remarques éventuelles sur cet achat..."
              rows={2}
            />
          </div>
        </div>

        <Separator />

        <div>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Produits</h3>
            <Button type="button" variant="outline" size="sm" onClick={addLine}>
              <Plus aria-hidden="true" className="h-4 w-4" />
              Ajouter ligne
            </Button>
          </div>

          {errors.lignesMessage && (
            <p className="mt-2 text-xs text-destructive">
              {errors.lignesMessage}
            </p>
          )}

          <div className="mt-3 rounded-2xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produit</TableHead>
                  <TableHead className="w-24 text-right">Quantité</TableHead>
                  <TableHead className="w-28 text-right">Prix Achat</TableHead>
                  <TableHead className="w-24 text-right">Remise %</TableHead>
                  <TableHead className="text-right">Sous-total</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {values.lignes.map((line) => {
                  const invalid = !!errors.invalidLineKeys[line.key];

                  return (
                    <TableRow key={line.key}>
                      <TableCell>
                        <ProductCombobox
                          value={line.product}
                          onChange={(product) => {
                            if (!product) return;
                            updateLine(line.key, {
                              productId: product.id,
                              product,
                              prixAchat: product.purchasePrice ?? line.prixAchat,
                            });
                          }}
                          preload={productOptions}
                          placeholder="Sélectionner"
                          label={null}
                        />
                      </TableCell>
                      <TableCell>
                        <input
                          type="number"
                          min={0}
                          value={line.quantite}
                          onChange={(event) =>
                            updateLine(line.key, {
                              quantite: Number(event.target.value),
                            })
                          }
                          aria-invalid={invalid}
                          className={cn(
                            "h-9 w-full rounded-md border border-input bg-transparent px-2 text-right text-sm outline-none focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15",
                            invalid && "border-destructive",
                          )}
                        />
                      </TableCell>
                      <TableCell>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={line.prixAchat}
                          onChange={(event) =>
                            updateLine(line.key, {
                              prixAchat: Number(event.target.value),
                            })
                          }
                          aria-invalid={invalid}
                          className={cn(
                            "h-9 w-full rounded-md border border-input bg-transparent px-2 text-right text-sm outline-none focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15",
                            invalid && "border-destructive",
                          )}
                        />
                      </TableCell>
                      <TableCell>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={line.remisePercent}
                          onChange={(event) =>
                            updateLine(line.key, {
                              remisePercent: Number(event.target.value),
                            })
                          }
                          className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-right text-sm outline-none focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15"
                        />
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatCurrency(computeLineSousTotal(line))}
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Supprimer la ligne"
                          disabled={values.lignes.length === 1}
                          onClick={() => removeLine(line.key)}
                          className="text-muted-foreground hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>

        <Separator />

        <div>
          <h3 className="text-sm font-semibold text-foreground">Résumé</h3>
          <div className="mt-3 ml-auto max-w-xs space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total HT</span>
              <span className="tabular-nums text-foreground">
                {formatCurrency(totals.totalHT)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">TVA</span>
              <span className="tabular-nums text-foreground">
                {formatCurrency(totals.totalTVA)}
              </span>
            </div>
            <div className="flex items-center justify-between text-base font-semibold">
              <span className="text-foreground">Total TTC</span>
              <span className="tabular-nums text-emerald-700">
                {formatCurrency(totals.totalTTC)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          Annuler
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Enregistrement..." : "Enregistrer"}
        </Button>
      </DialogFooter>
    </form>
  );
}
