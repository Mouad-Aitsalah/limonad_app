"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { CreditNotePosScreen } from "@/components/credit-notes/credit-note-pos-screen";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CustomerDto, StockLocationDto, SupplierPartnerDto } from "@/types/operations-dto";
import type { ProductDto } from "@/types/product-dto";

type CreditNoteTabsProps = {
  customers: CustomerDto[];
  suppliers: SupplierPartnerDto[];
  products: ProductDto[];
  locations: StockLocationDto[];
};

/**
 * Page « Avoir client / fournisseur »: the two top buttons and, under the chosen one, the POS-based
 * credit note screen. The history, invoice-linking and manual-return entries are gone from the page (the credit
 * notes are listed with the invoices; their server functions remain).
 */
export function CreditNoteTabs({ customers, suppliers, products, locations }: CreditNoteTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const activeType = searchParams.get("type") === "supplier" ? "supplier" : "client";

  function selectType(next: "client" | "supplier") {
    const params = new URLSearchParams(searchParams.toString());
    params.set("type", next);
    router.replace(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="space-y-6">
      <Tabs value={activeType} onValueChange={(value) => selectType(value as "client" | "supplier")} className="space-y-6">
        <TabsList variant="line" className="rounded-2xl border border-border bg-muted/30 p-1">
          <TabsTrigger value="client">Avoir client</TabsTrigger>
          <TabsTrigger value="supplier">Avoir fournisseur</TabsTrigger>
        </TabsList>

        <TabsContent value="client">
          <CreditNotePosScreen
            key="client"
            party="client"
            customers={customers}
            suppliers={suppliers}
            products={products}
            locations={locations}
          />
        </TabsContent>

        <TabsContent value="supplier">
          <CreditNotePosScreen
            key="supplier"
            party="fournisseur"
            customers={customers}
            suppliers={suppliers}
            products={products}
            locations={locations}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
