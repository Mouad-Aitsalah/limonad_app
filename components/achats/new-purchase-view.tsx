"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { PurchaseForm } from "@/components/achats/purchase-form";
import { submitPurchase } from "@/components/achats/submit-purchase";
import type { ProductDto, ProductOptionDto } from "@/types/product-dto";

/**
 * The dedicated "Achats > Achat" page: the exact same PurchaseForm the
 * "+ Nouveau Achat" shortcut used to open in a dialog, rendered inline. One
 * create path only - see submitPurchase.
 */
export function NewPurchaseView() {
  const router = useRouter();
  const [supplierOptions, setSupplierOptions] = React.useState<ProductOptionDto[]>([]);
  const [productOptions, setProductOptions] = React.useState<ProductDto[]>([]);

  React.useEffect(() => {
    let cancelled = false;

    async function loadSuppliers() {
      const response = await fetch("/api/suppliers", { cache: "no-store" });
      const payload = (await response.json()) as { suppliers?: ProductOptionDto[] };
      if (!response.ok || !payload.suppliers) {
        throw new Error("Impossible de charger les fournisseurs.");
      }
      if (!cancelled) setSupplierOptions(payload.suppliers);
    }

    // Same bounded preload the historique page uses (see PurchaseForm's
    // product search for how the rest is fetched on demand).
    async function loadProducts() {
      const response = await fetch("/api/products/preload", { cache: "no-store" });
      const payload = (await response.json()) as { products?: ProductDto[] };
      if (!response.ok || !payload.products) {
        throw new Error("Impossible de charger les produits.");
      }
      if (!cancelled) setProductOptions(payload.products);
    }

    void loadSuppliers().catch(() => {
      if (!cancelled) setSupplierOptions([]);
    });
    void loadProducts().catch(() => {
      if (!cancelled) setProductOptions([]);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Nouvel achat</h1>
        <p className="text-sm text-muted-foreground">Saisir une facture fournisseur.</p>
      </div>

      <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
        <CardContent className="pt-6">
          <PurchaseForm
            productOptions={productOptions}
            supplierOptions={supplierOptions}
            onCancel={() => router.push("/achats")}
            onSaved={async (purchase) => {
              const created = await submitPurchase(purchase);
              toast.success(`Achat ${created.numero} enregistré avec succès.`);
              router.push("/achats");
              router.refresh();
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
