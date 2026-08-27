import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProductFormValues } from "@/components/produits/product-form";

type Option = { value: string; label: string };

type ProductFormGeneralProps = {
  values: ProductFormValues;
  onChange: <K extends keyof ProductFormValues>(
    field: K,
    value: ProductFormValues[K],
  ) => void;
  categories: Option[];
  suppliers: Option[];
  brands: Option[];
  fieldErrors: Record<string, string>;
  readOnly: boolean;
};

function optionLabel(options: Option[], value: string | null) {
  return options.find((option) => option.value === value)?.label;
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}

export function ProductFormGeneral({
  values,
  onChange,
  categories,
  suppliers,
  brands,
  fieldErrors,
  readOnly,
}: ProductFormGeneralProps) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-foreground">
          Informations generales
        </h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="reference">Reference</Label>
            <Input
              id="reference"
              value={values.reference}
              disabled={readOnly}
              onChange={(event) => onChange("reference", event.target.value)}
              placeholder="NIKE-AM90-BLK"
            />
            <FieldError message={fieldErrors.reference} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="barcode">Code-barres</Label>
            <Input
              id="barcode"
              value={values.barcode ?? ""}
              disabled={readOnly}
              onChange={(event) => onChange("barcode", event.target.value)}
              placeholder="3600550100011"
            />
            <FieldError message={fieldErrors.barcode} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="name">Designation</Label>
            <Input
              id="name"
              value={values.name}
              disabled={readOnly}
              onChange={(event) => onChange("name", event.target.value)}
              placeholder="Nike Air Max 90"
            />
            <FieldError message={fieldErrors.name} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={values.description ?? ""}
              disabled={readOnly}
              onChange={(event) => onChange("description", event.target.value)}
              placeholder="Description optionnelle"
            />
            <FieldError message={fieldErrors.description} />
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-foreground">Relations</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>Categorie</Label>
            <Select
              value={values.categoryId || null}
              onValueChange={(value) => onChange("categoryId", value ?? "")}
              disabled={readOnly}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selectionner">
                  {(value: string | null) =>
                    optionLabel(categories, value) ?? "Selectionner"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {categories.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError message={fieldErrors.categoryId} />
          </div>

          <div className="space-y-2">
            <Label>Fournisseur</Label>
            <Select
              value={values.defaultSupplierId || null}
              onValueChange={(value) =>
                onChange("defaultSupplierId", value ?? "")
              }
              disabled={readOnly}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Optionnel">
                  {(value: string | null) =>
                    optionLabel(suppliers, value) ?? "Optionnel"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {suppliers.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError message={fieldErrors.defaultSupplierId} />
          </div>

          <div className="space-y-2">
            <Label>Marque</Label>
            <Select
              value={values.brandId || null}
              onValueChange={(value) => onChange("brandId", value ?? "")}
              disabled={readOnly}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Optionnel">
                  {(value: string | null) =>
                    optionLabel(brands, value) ?? "Optionnel"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {brands.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError message={fieldErrors.brandId} />
          </div>
        </div>
      </div>
    </div>
  );
}
