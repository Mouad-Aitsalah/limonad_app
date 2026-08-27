"use client";

import * as React from "react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { CreditNoteDetailDialog } from "@/components/avoirs/credit-note-detail-dialog";
import { CreditNoteDialog } from "@/components/avoirs/credit-note-dialog";
import { CreditNoteKpiCards } from "@/components/avoirs/credit-note-kpi-cards";
import {
  CreditNotesToolbar,
  type CreditNoteFilters,
} from "@/components/avoirs/credit-notes-toolbar";
import { CreditNotesTable } from "@/components/avoirs/credit-notes-table";
import type { CreditNote, CreateCreditNoteInput } from "@/types/credit-note";
import type { CustomerDto } from "@/types/operations-dto";

const defaultFilters: CreditNoteFilters = {
  search: "",
  date: "",
  clientId: "all",
  status: "all",
  origin: "all",
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

type CreditNotesViewProps = {
  initialCreditNotes: CreditNote[];
  customers: CustomerDto[];
};

export function CreditNotesView({
  initialCreditNotes,
  customers,
}: CreditNotesViewProps) {
  const [creditNotes, setCreditNotes] =
    React.useState<CreditNote[]>(initialCreditNotes);
  const [filters, setFilters] = React.useState<CreditNoteFilters>(defaultFilters);
  const [selectedCreditNote, setSelectedCreditNote] =
    React.useState<CreditNote | null>(null);

  const clients = React.useMemo(
    () => customers.map((customer) => ({ id: customer.id, label: customer.name })),
    [customers],
  );

  const filteredCreditNotes = React.useMemo(() => {
    const query = normalize(filters.search);

    return creditNotes
      .filter((creditNote) => {
        const searchText = normalize(
          [
            creditNote.number,
            creditNote.invoiceNumber,
            creditNote.customerName ?? "",
          ].join(" "),
        );
        const matchesSearch = query.length === 0 || searchText.includes(query);
        const matchesDate =
          filters.date.length === 0 ||
          creditNote.returnDate.slice(0, 10) === filters.date;
        const matchesClient =
          filters.clientId === "all" || creditNote.customerId === filters.clientId;
        const matchesStatus =
          filters.status === "all" || creditNote.status === filters.status;
        const matchesOrigin =
          filters.origin === "all" || creditNote.saleOrigin === filters.origin;

        return (
          matchesSearch &&
          matchesDate &&
          matchesClient &&
          matchesStatus &&
          matchesOrigin
        );
      })
      .sort(
        (a, b) =>
          new Date(b.returnDate).getTime() - new Date(a.returnDate).getTime(),
      );
  }, [creditNotes, filters]);

  function handleFilterChange<K extends keyof CreditNoteFilters>(
    key: K,
    value: CreditNoteFilters[K],
  ) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSaved(input: CreateCreditNoteInput, status: CreditNote["status"]) {
    const response = await fetch("/api/credit-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, status }),
    });
    const payload = (await response.json()) as {
      creditNote?: CreditNote;
      message?: string;
    };
    if (!response.ok || !payload.creditNote) {
      toast.error(payload.message ?? "Impossible de creer l'avoir.");
      return;
    }

    toast.success(
      status === "VALIDE"
        ? "Avoir valide et stock mis a jour."
        : "Avoir enregistre en brouillon.",
    );
    setCreditNotes((prev) => [payload.creditNote as CreditNote, ...prev]);
  }

  function handleDeleteDraft(creditNoteId: string) {
    setCreditNotes((prev) =>
      prev.filter(
        (creditNote) =>
          creditNote.id !== creditNoteId || creditNote.status !== "BROUILLON",
      ),
    );
    toast.success("Brouillon supprime.");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            Avoirs
          </h1>
          <p className="text-sm text-muted-foreground">
            Retours de marchandises clients lies aux factures existantes.
          </p>
        </div>

        <CreditNoteDialog customers={customers} onSaved={handleSaved} />
      </div>

      <CreditNoteKpiCards creditNotes={creditNotes} />

      <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
        <CardContent className="space-y-5">
          <CreditNotesToolbar
            filters={filters}
            clients={clients}
            onChange={handleFilterChange}
          />

          <p className="text-sm text-muted-foreground">
            {filteredCreditNotes.length} avoir
            {filteredCreditNotes.length > 1 ? "s" : ""}
          </p>

          <CreditNotesTable
            creditNotes={filteredCreditNotes}
            onView={setSelectedCreditNote}
            onDeleteDraft={handleDeleteDraft}
          />
        </CardContent>
      </Card>

      <CreditNoteDetailDialog
        creditNote={selectedCreditNote}
        open={selectedCreditNote !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedCreditNote(null);
        }}
      />
    </div>
  );
}
