import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  computePriceHTFromTTC,
} from "@/lib/product-pricing";
import { formatCurrency } from "@/lib/utils";
import type { ProductFormValues } from "@/components/produits/product-form";

type ProductFormPricingProps = {
  values: ProductFormValues;
  onChange: <K extends keyof ProductFormValues>(
    field: K,
    value: ProductFormValues[K],
  ) => void;
  fieldErrors: Record<string, string>;
  readOnly: boolean;
};

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}

export function ProductFormPricing({
  values,
  onChange,
  fieldErrors,
  readOnly,
}: ProductFormPricingProps) {
  const purchasePriceHT = computePriceHTFromTTC(
    values.purchasePriceTTC,
    values.taxRate,
  );
  const salePriceHT = computePriceHTFromTTC(values.salePriceTTC, values.taxRate);

  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground">Prix</h3>
      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="purchasePrice">Prix achat TTC</Label>
          <Input
            id="purchasePrice"
            type="number"
            min={0}
            step="0.01"
            value={values.purchasePriceTTC}
            disabled={readOnly}
            onChange={(event) =>
              onChange("purchasePriceTTC", Number(event.target.value))
            }
          />
          <FieldError message={fieldErrors.purchasePrice} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="taxRate">TVA (%)</Label>
          <Input
            id="taxRate"
            type="number"
            min={0}
            step="0.1"
            value={values.taxRate}
            disabled={readOnly}
            onChange={(event) => onChange("taxRate", Number(event.target.value))}
          />
          <FieldError message={fieldErrors.taxRate} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="purchasePriceHT">Prix achat HT calculé</Label>
          <Input
            id="purchasePriceHT"
            readOnly
            value={formatCurrency(purchasePriceHT)}
            className="bg-muted text-muted-foreground"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="salePrice">Prix vente TTC</Label>
          <Input
            id="salePrice"
            type="number"
            min={0}
            step="0.01"
            value={values.salePriceTTC}
            disabled={readOnly}
            onChange={(event) =>
              onChange("salePriceTTC", Number(event.target.value))
            }
          />
          <FieldError message={fieldErrors.salePrice} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="salePriceHT">Prix vente HT calculé</Label>
          <Input
            id="salePriceHT"
            readOnly
            value={formatCurrency(salePriceHT)}
            className="bg-muted text-muted-foreground"
          />
        </div>
      </div>
    </div>
  );
}
