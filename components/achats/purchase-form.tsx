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
import { computePriceTTC } from "@/lib/product-pricing";
import {
  computeDraftLineTotalTTC,
  computeDraftPurchaseTotalsTTC,
  DEFAULT_PURCHASE_TVA_RATE,
} from "@/lib/purchase-calculations";
import {
  computeDoubleDiscountLine,
  computeDraftPurchaseTotalsDoubleDiscountHT,
} from "@/lib/purchase-pricing";
import { cn, formatCurrency } from "@/lib/utils";
import type {
  PurchaseInput,
  PurchasePaymentMethod,
  PurchasePricingMode,
} from "@/types/purchase";
import type { ProductDto, ProductOptionDto } from "@/types/product-dto";

function productPurchasePriceTTC(product: ProductDto | null): number {
  if (!product) return 0;
  return computePriceTTC(product.purchasePrice, product.taxRate);
}

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
  // --- CLASSIC_TTC ---
  /** Unit purchase price tax INCLUDED (prefilled from product.purchasePrice + taxRate). */
  prixAchatTTC: number;
  remisePercent: number;
  // --- DOUBLE_DISCOUNT_HT ---
  /** Gross HT unit price - prefilled from product.purchasePrice, editable per line. */
  prixBrutHT: number;
  remise1Percent: number;
  remise2Percent: number;
};

function createLine(key: string, productOptions: ProductDto[]): LineDraft {
  const product = productOptions[0] ?? null;
  return {
    key,
    productId: product?.id ?? "",
    product,
    quantite: 1,
    prixAchatTTC: productPurchasePriceTTC(product),
    remisePercent: 0,
    prixBrutHT: product?.purchasePrice ?? 0,
    remise1Percent: 0,
    remise2Percent: 0,
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

function clampPercent(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

type FormErrors = {
  fournisseur?: string;
  numeroCheque?: string;
  lignesMessage?: string;
  invalidLineKeys: Record<string, boolean>;
};

function validate(
  values: PurchaseFormValues,
  pricingMode: PurchasePricingMode,
): FormErrors {
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
    const priceInvalid =
      pricingMode === "DOUBLE_DISCOUNT_HT"
        ? line.prixBrutHT <= 0
        : line.prixAchatTTC <= 0;
    if (line.productId.trim().length === 0 || line.quantite <= 0 || priceInvalid) {
      errors.invalidLineKeys[line.key] = true;
      hasLineError = true;
    }
  }
  if (hasLineError && !errors.lignesMessage) {
    errors.lignesMessage =
      pricingMode === "DOUBLE_DISCOUNT_HT"
        ? "Chaque ligne doit avoir une quantité et un prix brut HT supérieurs à 0."
        : "Chaque ligne doit avoir une quantité et un prix supérieurs à 0.";
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
  onSaved: (purchase: PurchaseInput) => Promise<void>;
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
  // One mode for the whole purchase (mutually exclusive). CLASSIC_TTC keeps
  // the historical behaviour exactly.
  const [pricingMode, setPricingMode] =
    React.useState<PurchasePricingMode>("CLASSIC_TTC");
  const [errors, setErrors] = React.useState<FormErrors>({ invalidLineKeys: {} });
  const [submitting, setSubmitting] = React.useState(false);
  const lineKeyCounter = React.useRef(1);
  // True once the operator has actually touched the lines - drives the
  // "changing the mode clears the lines" confirmation (an untouched default
  // line switches freely).
  const linesDirtyRef = React.useRef(false);

  function handleChange<K extends keyof PurchaseFormValues>(
    field: K,
    value: PurchaseFormValues[K],
  ) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  function updateLine(key: string, patch: Partial<LineDraft>) {
    linesDirtyRef.current = true;
    setValues((prev) => ({
      ...prev,
      lignes: prev.lignes.map((line) =>
        line.key === key ? { ...line, ...patch } : line,
      ),
    }));
  }

  function addLine() {
    linesDirtyRef.current = true;
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
    linesDirtyRef.current = true;
    setValues((prev) => ({
      ...prev,
      lignes: prev.lignes.filter((line) => line.key !== key),
    }));
  }

  // §8: free switch while nothing is entered; otherwise confirm - and never
  // silently convert prices, always reset to a single fresh line.
  function switchMode(next: PurchasePricingMode) {
    if (next === pricingMode) return;
    if (linesDirtyRef.current) {
      const ok = window.confirm(
        "Changer le type d'achat supprimera les lignes déjà saisies.\nContinuer ?",
      );
      if (!ok) return;
    }
    lineKeyCounter.current += 1;
    linesDirtyRef.current = false;
    setValues((prev) => ({
      ...prev,
      lignes: [createLine(`line-${lineKeyCounter.current}`, productOptions)],
    }));
    setErrors({ invalidLineKeys: {} });
    setPricingMode(next);
  }

  const isDouble = pricingMode === "DOUBLE_DISCOUNT_HT";

  const totals = isDouble
    ? computeDraftPurchaseTotalsDoubleDiscountHT(
        values.lignes.map((line) => ({
          quantite: line.quantite,
          grossHT: line.prixBrutHT,
          discount1: line.remise1Percent,
          discount2: line.remise2Percent,
          taxRate: line.product?.taxRate ?? DEFAULT_PURCHASE_TVA_RATE,
        })),
      )
    : computeDraftPurchaseTotalsTTC(
        values.lignes.map((line) => ({
          quantite: line.quantite,
          prixAchatTTC: line.prixAchatTTC,
          remisePercent: line.remisePercent,
          taxRate: line.product?.taxRate ?? DEFAULT_PURCHASE_TVA_RATE,
        })),
      );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const validationErrors = validate(values, pricingMode);
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
        pricingMode,
        lignes: isDouble
          ? values.lignes.map((line) => ({
              productId: line.productId,
              quantite: line.quantite,
              prixBrutHT: line.prixBrutHT,
              remise1Percent: line.remise1Percent,
              remise2Percent: line.remise2Percent,
            }))
          : values.lignes.map((line) => ({
              productId: line.productId,
              quantite: line.quantite,
              prixAchatTTC: line.prixAchatTTC,
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
          <Label className="text-sm font-semibold text-foreground">
            Type d&apos;achat
          </Label>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              variant={pricingMode === "CLASSIC_TTC" ? "default" : "outline"}
              size="sm"
              aria-pressed={pricingMode === "CLASSIC_TTC"}
              onClick={() => switchMode("CLASSIC_TTC")}
            >
              Classique TTC
            </Button>
            <Button
              type="button"
              variant={
                pricingMode === "DOUBLE_DISCOUNT_HT" ? "default" : "outline"
              }
              size="sm"
              aria-pressed={pricingMode === "DOUBLE_DISCOUNT_HT"}
              onClick={() => switchMode("DOUBLE_DISCOUNT_HT")}
            >
              Double remise HT
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {isDouble
              ? "Prix brut HT (repris de la fiche produit, modifiable) puis remise 1 puis remise 2 successives."
              : "Prix d'achat TTC et une remise, comme aujourd'hui."}
          </p>
        </div>

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
                  {isDouble ? (
                    <>
                      <TableHead className="w-28 text-right">
                        Prix brut HT
                      </TableHead>
                      <TableHead className="w-24 text-right">Remise 1 %</TableHead>
                      <TableHead className="w-24 text-right">Remise 2 %</TableHead>
                      <TableHead className="text-right">Prix net HT</TableHead>
                    </>
                  ) : (
                    <>
                      <TableHead className="w-28 text-right">
                        Prix Achat TTC
                      </TableHead>
                      <TableHead className="w-24 text-right">Remise %</TableHead>
                      <TableHead className="text-right">Sous-total TTC</TableHead>
                    </>
                  )}
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {values.lignes.map((line) => {
                  const invalid = !!errors.invalidLineKeys[line.key];
                  const taxRate =
                    line.product?.taxRate ?? DEFAULT_PURCHASE_TVA_RATE;
                  const netUnitHT = computeDoubleDiscountLine({
                    quantite: line.quantite,
                    grossHT: line.prixBrutHT,
                    discount1: line.remise1Percent,
                    discount2: line.remise2Percent,
                    taxRate,
                  }).netUnitHTDisplay;

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
                              prixAchatTTC: productPurchasePriceTTC(product),
                              prixBrutHT: product.purchasePrice,
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

                      {isDouble ? (
                        <>
                          <TableCell>
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={line.prixBrutHT}
                              onChange={(event) =>
                                updateLine(line.key, {
                                  prixBrutHT: Number(event.target.value),
                                })
                              }
                              aria-label="Prix brut HT"
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
                              value={line.remise1Percent}
                              onChange={(event) =>
                                updateLine(line.key, {
                                  remise1Percent: clampPercent(
                                    Number(event.target.value),
                                  ),
                                })
                              }
                              aria-label="Remise 1 en pourcentage"
                              className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-right text-sm outline-none focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15"
                            />
                          </TableCell>
                          <TableCell>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={line.remise2Percent}
                              onChange={(event) =>
                                updateLine(line.key, {
                                  remise2Percent: clampPercent(
                                    Number(event.target.value),
                                  ),
                                })
                              }
                              aria-label="Remise 2 en pourcentage"
                              className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-right text-sm outline-none focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15"
                            />
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {formatCurrency(netUnitHT)}
                          </TableCell>
                        </>
                      ) : (
                        <>
                          <TableCell>
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={line.prixAchatTTC}
                              onChange={(event) =>
                                updateLine(line.key, {
                                  prixAchatTTC: Number(event.target.value),
                                })
                              }
                              aria-label="Prix d'achat TTC"
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
                                  remisePercent: clampPercent(
                                    Number(event.target.value),
                                  ),
                                })
                              }
                              aria-label="Remise en pourcentage"
                              className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-right text-sm outline-none focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15"
                            />
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {formatCurrency(
                              computeDraftLineTotalTTC({
                                quantite: line.quantite,
                                prixAchatTTC: line.prixAchatTTC,
                                remisePercent: line.remisePercent,
                              }),
                            )}
                          </TableCell>
                        </>
                      )}

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
