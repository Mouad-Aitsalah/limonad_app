"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { CreditNotePosView } from "@/components/credit-notes/credit-note-pos-view";
import { CreditNotesHistory } from "@/components/credit-notes/credit-notes-history";
import { SupplierCreditNotePosView } from "@/components/credit-notes/supplier-credit-note-pos-view";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CurrentUser } from "@/types/auth";
import type { CreditNote } from "@/types/credit-note";
import type { CustomerDto, StockLocationDto, SupplierPartnerDto } from "@/types/operations-dto";
import type { ProductDto } from "@/types/product-dto";

type CreditNoteTabsProps = {
  initialCreditNotes: CreditNote[];
  customers: CustomerDto[];
  suppliers: SupplierPartnerDto[];
  products: ProductDto[];
  locations: StockLocationDto[];
  currentUser: CurrentUser;
};

export function CreditNoteTabs({
  initialCreditNotes,
  customers,
  suppliers,
  products,
  locations,
  currentUser,
}: CreditNoteTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [creditNotes, setCreditNotes] = React.useState(initialCreditNotes);
  const [editingCreditNote, setEditingCreditNote] = React.useState<CreditNote | null>(null);

  const activeType = searchParams.get("type") === "supplier" ? "supplier" : "client";
  const activeTab = searchParams.get("tab") === "history" ? "history" : "create";

  function updateView(next: { type?: "client" | "supplier"; tab?: "create" | "history" }) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("type", next.type ?? activeType);
    params.set("tab", next.tab ?? activeTab);
    router.replace(`${pathname}?${params.toString()}`);
  }

  function upsertCreditNote(creditNote: CreditNote) {
    setCreditNotes((current) =>
      [...current.filter((item) => item.id !== creditNote.id), creditNote].sort(
        (a, b) => new Date(b.returnDate).getTime() - new Date(a.returnDate).getTime(),
      ),
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Avoirs</h1>
        <p className="text-sm text-muted-foreground">
          Gestion des retours clients et fournisseurs, brouillons et mouvements de stock.
        </p>
      </div>

      <Tabs
        value={activeType}
        onValueChange={(value) => {
          const nextType = value as "client" | "supplier";
          if (editingCreditNote && editingCreditNote.partyType !== mapUrlTypeToPartyType(nextType)) {
            setEditingCreditNote(null);
          }
          updateView({ type: nextType });
        }}
        className="space-y-6"
      >
        <TabsList variant="line" className="rounded-2xl border border-border bg-muted/30 p-1">
          <TabsTrigger value="client">Avoir client</TabsTrigger>
          <TabsTrigger value="supplier">Avoir fournisseur</TabsTrigger>
        </TabsList>

        <TabsContent value="client" className="space-y-6">
          <Tabs
            value={activeTab}
            onValueChange={(value) => updateView({ tab: value as "create" | "history" })}
            className="space-y-6"
          >
            <TabsList variant="line" className="rounded-2xl border border-border bg-muted/30 p-1">
              <TabsTrigger value="create">Avoir</TabsTrigger>
              <TabsTrigger value="history">Historique des avoirs</TabsTrigger>
            </TabsList>

            <TabsContent value="create">
              <CreditNotePosView
                key={
                  editingCreditNote?.partyType === "client"
                    ? editingCreditNote.id
                    : "new-client-credit-note"
                }
                customers={customers}
                products={products}
                locations={locations}
                currentUser={currentUser}
                editingCreditNote={editingCreditNote?.partyType === "client" ? editingCreditNote : null}
                onSaved={(creditNote) => {
                  upsertCreditNote(creditNote);
                  setEditingCreditNote(null);
                }}
                onClearEditing={() => setEditingCreditNote(null)}
              />
            </TabsContent>

            <TabsContent value="history">
              <CreditNotesHistory
                partyType="client"
                creditNotes={creditNotes}
                customers={customers}
                suppliers={suppliers}
                locations={locations}
                currentUser={currentUser}
                onEditDraft={(creditNote) => {
                  setEditingCreditNote(creditNote);
                  updateView({ type: "client", tab: "create" });
                }}
                onCreditNoteUpdated={(creditNote) => {
                  upsertCreditNote(creditNote);
                  if (editingCreditNote?.id === creditNote.id && creditNote.status !== "BROUILLON") {
                    setEditingCreditNote(null);
                  }
                }}
              />
            </TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="supplier" className="space-y-6">
          <Tabs
            value={activeTab}
            onValueChange={(value) => updateView({ tab: value as "create" | "history" })}
            className="space-y-6"
          >
            <TabsList variant="line" className="rounded-2xl border border-border bg-muted/30 p-1">
              <TabsTrigger value="create">Avoir</TabsTrigger>
              <TabsTrigger value="history">Historique des avoirs</TabsTrigger>
            </TabsList>

            <TabsContent value="create">
              <SupplierCreditNotePosView
                key={
                  editingCreditNote?.partyType === "fournisseur"
                    ? editingCreditNote.id
                    : "new-supplier-credit-note"
                }
                suppliers={suppliers}
                products={products}
                locations={locations}
                currentUser={currentUser}
                editingCreditNote={
                  editingCreditNote?.partyType === "fournisseur" ? editingCreditNote : null
                }
                onSaved={(creditNote) => {
                  upsertCreditNote(creditNote);
                  setEditingCreditNote(null);
                }}
                onClearEditing={() => setEditingCreditNote(null)}
              />
            </TabsContent>

            <TabsContent value="history">
              <CreditNotesHistory
                partyType="fournisseur"
                creditNotes={creditNotes}
                customers={customers}
                suppliers={suppliers}
                locations={locations}
                currentUser={currentUser}
                onEditDraft={(creditNote) => {
                  setEditingCreditNote(creditNote);
                  updateView({ type: "supplier", tab: "create" });
                }}
                onCreditNoteUpdated={(creditNote) => {
                  upsertCreditNote(creditNote);
                  if (editingCreditNote?.id === creditNote.id && creditNote.status !== "BROUILLON") {
                    setEditingCreditNote(null);
                  }
                }}
              />
            </TabsContent>
          </Tabs>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function mapUrlTypeToPartyType(type: "client" | "supplier") {
  return type === "supplier" ? "fournisseur" : "client";
}
