"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Plus, Printer } from "lucide-react";
import { toast } from "sonner";

import { PurchasePrint } from "@/components/achats/purchase-print";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PurchaseForm } from "@/components/achats/purchase-form";
import { submitPurchase } from "@/components/achats/submit-purchase";
import type { ProductDto, ProductOptionDto } from "@/types/product-dto";
import type { Purchase } from "@/types/purchase";
import type { AccountingAccountDto, AccountingAccountOptionDto } from "@/types/accounting";

/**
 * The dedicated "Achats > Achat" page: the exact same PurchaseForm the
 * "+ Nouveau Achat" shortcut used to open in a dialog, rendered inline. One
 * create path only - see submitPurchase.
 */
export function NewPurchaseView() {
  const router = useRouter();
  const [supplierOptions, setSupplierOptions] = React.useState<ProductOptionDto[]>([]);
  const [productOptions, setProductOptions] = React.useState<ProductDto[]>([]);
  const [bankAccountOptions, setBankAccountOptions] = React.useState<
    AccountingAccountOptionDto[]
  >([]);
  // Set once the purchase is persisted - drives the confirmation panel below,
  // whose data is exactly what the API returned from the database.
  const [createdPurchase, setCreatedPurchase] = React.useState<Purchase | null>(null);
  const [printing, setPrinting] = React.useState<Purchase | null>(null);

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

    async function loadBankAccounts() {
      const response = await fetch("/api/accounting/accounts", { cache: "no-store" });
      const payload = (await response.json()) as { accounts?: AccountingAccountDto[] };
      if (!response.ok || !payload.accounts) {
        throw new Error("Impossible de charger les comptes bancaires.");
      }
      const accounts = payload.accounts.filter(
        (account) => account.isActive && account.code.startsWith("5141"),
      );
      if (!cancelled) setBankAccountOptions(accounts);
    }

    void loadSuppliers().catch(() => {
      if (!cancelled) setSupplierOptions([]);
    });
    void loadProducts().catch(() => {
      if (!cancelled) setProductOptions([]);
    });
    void loadBankAccounts().catch(() => {
      if (!cancelled) setBankAccountOptions([]);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const supplierName = createdPurchase
    ? createdPurchase.fournisseurNom ??
      supplierOptions.find((s) => s.id === createdPurchase.fournisseurId)?.name ??
      "-"
    : "-";

  if (createdPurchase) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">Nouvel achat</h1>
          <p className="text-sm text-muted-foreground">Saisir une facture fournisseur.</p>
        </div>

        <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
          <CardContent className="space-y-5 pt-6">
            <div className="flex items-start gap-3">
              <CheckCircle2
                aria-hidden="true"
                className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600"
              />
              <div>
                <p className="font-heading text-lg font-semibold text-foreground">
                  Achat enregistré avec succès.
                </p>
                <p className="text-sm text-muted-foreground">
                  {createdPurchase.numero} · {supplierName}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => setPrinting(createdPurchase)}>
                <Printer aria-hidden="true" className="h-4 w-4" />
                Imprimer
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setCreatedPurchase(null);
                }}
              >
                <Plus aria-hidden="true" className="h-4 w-4" />
                Nouvel achat
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  router.push("/achats");
                  router.refresh();
                }}
              >
                Voir l&apos;historique
              </Button>
            </div>
          </CardContent>
        </Card>

        <PurchasePrint
          purchase={printing}
          supplierName={supplierName}
          onDone={() => setPrinting(null)}
        />
      </div>
    );
  }

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
            bankAccountOptions={bankAccountOptions}
            onCancel={() => router.push("/achats")}
            onSaved={async (purchase) => {
              const created = await submitPurchase(purchase);
              toast.success(`Achat ${created.numero} enregistré avec succès.`);
              setCreatedPurchase({
                ...created,
                date: new Date(created.date),
                datePaiement: created.datePaiement ? new Date(created.datePaiement) : null,
                createdAt: new Date(created.createdAt),
                updatedAt: new Date(created.updatedAt),
              });
              router.refresh();
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
