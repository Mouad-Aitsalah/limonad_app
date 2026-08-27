"use client";

import * as React from "react";

import { Card, CardContent } from "@/components/ui/card";
import { ContactDialog } from "@/components/contacts/contact-dialog";
import {
  ContactsTable,
  type ContactsSortKey,
  type ContactsSortState,
} from "@/components/contacts/contacts-table";
import { ContactsToolbar } from "@/components/contacts/contacts-toolbar";
import type { ContactDto, ContactsSummaryDto } from "@/types/contacts";
import type { SupplierPartnerDto } from "@/types/operations-dto";

type ContactsViewProps = {
  initialContacts: ContactDto[];
  initialSummary: ContactsSummaryDto;
  suppliers: SupplierPartnerDto[];
};

export function ContactsView({ initialContacts, initialSummary, suppliers }: ContactsViewProps) {
  const [contacts, setContacts] = React.useState(initialContacts);
  const [summary, setSummary] = React.useState(initialSummary);
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState("all");
  const [editingContact, setEditingContact] = React.useState<ContactDto | null>(null);
  const [sort, setSort] = React.useState<ContactsSortState>({ key: "createdAt" as ContactsSortKey, direction: "desc" });

  const filteredContacts = React.useMemo(() => {
    const query = normalizeSearch(search);
    return contacts.filter((contact) => {
      const matchesSearch =
        query.length === 0 ||
        normalizeSearch(
          `${contact.reference} ${contact.fullName} ${contact.phone1 ?? ""} ${contact.phone2 ?? ""} ${contact.email ?? ""}`,
        ).includes(query);
      const matchesStatus = status === "all" || contact.status === status;
      return matchesSearch && matchesStatus;
    });
  }, [contacts, search, status]);

  const sortedContacts = React.useMemo(() => {
    const collator = new Intl.Collator("fr-FR", { sensitivity: "base" });
    return [...filteredContacts].sort((left, right) => {
      const factor = sort.direction === "asc" ? 1 : -1;
      switch (sort.key) {
        case "reference":
          return factor * collator.compare(left.reference, right.reference);
        case "fullName":
          return factor * collator.compare(left.fullName, right.fullName);
        case "status":
          return factor * collator.compare(left.status, right.status);
        case "createdAt":
          return factor * (new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
        default:
          return 0;
      }
    });
  }, [filteredContacts, sort]);

  function handleSortChange(key: ContactsSortKey) {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: key === "createdAt" ? "desc" : "asc" },
    );
  }

  async function refreshContacts() {
    const response = await fetch("/api/contacts", { cache: "no-store" });
    const payload = (await response.json()) as {
      items?: ContactDto[];
      summary?: ContactsSummaryDto;
      message?: string;
    };
    if (!response.ok || !payload.items || !payload.summary) {
      throw new Error(payload.message ?? "Impossible de recharger les contacts.");
    }
    setContacts(payload.items);
    setSummary(payload.summary);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">Contacts</h1>
          <p className="text-sm text-muted-foreground">
            Contacts generaux, independants des clients et fournisseurs.
          </p>
        </div>

        <ContactDialog suppliers={suppliers} onSaved={refreshContacts} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Total contacts" value={String(summary.totalCount)} />
        <SummaryCard label="Actifs" value={String(summary.activeCount)} />
        <SummaryCard label="Lies a un fournisseur" value={String(summary.linkedToSupplierCount)} />
        <SummaryCard label="Sans telephone" value={String(summary.withoutPhoneCount)} />
      </div>

      <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
        <CardContent className="space-y-5">
          <ContactsToolbar
            search={search}
            onSearchChange={setSearch}
            status={status}
            onStatusChange={setStatus}
          />

          <p className="text-sm text-muted-foreground">
            {sortedContacts.length} contact{sortedContacts.length > 1 ? "s" : ""}
          </p>

          <ContactsTable
            contacts={sortedContacts}
            sort={sort}
            onSortChange={handleSortChange}
            onEdit={setEditingContact}
          />
        </CardContent>
      </Card>

      <ContactDialog
        contact={editingContact}
        suppliers={suppliers}
        open={editingContact !== null}
        onOpenChange={(open) => {
          if (!open) setEditingContact(null);
        }}
        onSaved={refreshContacts}
      />
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
      <CardContent>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}
