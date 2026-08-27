"use client";

import * as React from "react";
import {
  Eye,
  FileCheck2,
  FileClock,
  Files,
  Printer,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";

import { CreditNoteStatusBadge } from "@/components/avoirs/credit-note-status-badge";
import { CreditNoteDetailView } from "@/components/credit-notes/credit-note-detail-view";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import type { CurrentUser } from "@/types/auth";
import type { CreditNote, CreditNotePartyType, CreditNoteStatus } from "@/types/credit-note";
import type {
  CustomerDto,
  StockLocationDto,
  SupplierPartnerDto,
} from "@/types/operations-dto";

type CreditNotesHistoryProps = {
  partyType: CreditNotePartyType;
  creditNotes: CreditNote[];
  customers: CustomerDto[];
  suppliers: SupplierPartnerDto[];
  locations: StockLocationDto[];
  currentUser: CurrentUser;
  onEditDraft: (creditNote: CreditNote) => void;
  onCreditNoteUpdated: (creditNote: CreditNote) => void;
};

type Filters = {
  search: string;
  dateFrom: string;
  dateTo: string;
  partnerId: string;
  status: CreditNoteStatus | "all";
  user: string;
  locationId: string;
};

const defaultFilters: Filters = {
  search: "",
  dateFrom: "",
  dateTo: "",
  partnerId: "all",
  status: "all",
  user: "all",
  locationId: "all",
};

export function CreditNotesHistory({
  partyType,
  creditNotes,
  customers,
  suppliers,
  locations,
  currentUser,
  onEditDraft,
  onCreditNoteUpdated,
}: CreditNotesHistoryProps) {
  const [filters, setFilters] = React.useState<Filters>(defaultFilters);
  const [selectedDetail, setSelectedDetail] = React.useState<CreditNote | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const partyLabel = partyType === "client" ? "Client" : "Fournisseur";
  const stockLabel = partyType === "client" ? "Destination stock" : "Stock source";

  const visibleNotes = React.useMemo(
    () => creditNotes.filter((creditNote) => creditNote.partyType === partyType),
    [creditNotes, partyType],
  );

  const filteredCreditNotes = React.useMemo(() => {
    const query = normalizeSearch(filters.search);

    return visibleNotes
      .filter((creditNote) => {
        const dateKey = toDateInputValue(creditNote.returnDate);
        const partnerName =
          partyType === "client"
            ? creditNote.customerName ?? ""
            : creditNote.supplierName ?? "";
        const partnerId =
          partyType === "client" ? creditNote.customerId : creditNote.supplierId;
        const locationId =
          partyType === "client"
            ? creditNote.stockDestinationLocationId
            : creditNote.stockSourceLocationId;
        const locationName =
          partyType === "client"
            ? creditNote.stockDestinationLocationName ?? ""
            : creditNote.stockSourceLocationName ?? "";

        const matchesSearch =
          !query ||
          normalizeSearch(
            [
              creditNote.number,
              creditNote.invoiceNumber ?? "",
              partnerName,
              creditNote.createdBy,
              locationName,
              creditNote.supplierCode ?? "",
            ].join(" "),
          ).includes(query);

        const matchesDateFrom = !filters.dateFrom || dateKey >= filters.dateFrom;
        const matchesDateTo = !filters.dateTo || dateKey <= filters.dateTo;
        const matchesPartner = filters.partnerId === "all" || partnerId === filters.partnerId;
        const matchesStatus = filters.status === "all" || creditNote.status === filters.status;
        const matchesUser = filters.user === "all" || creditNote.createdBy === filters.user;
        const matchesLocation = filters.locationId === "all" || locationId === filters.locationId;

        return (
          matchesSearch &&
          matchesDateFrom &&
          matchesDateTo &&
          matchesPartner &&
          matchesStatus &&
          matchesUser &&
          matchesLocation
        );
      })
      .sort((a, b) => new Date(b.returnDate).getTime() - new Date(a.returnDate).getTime());
  }, [filters, partyType, visibleNotes]);

  const totals = React.useMemo(() => {
    return filteredCreditNotes.reduce(
      (acc, note) => {
        const total = note.lines.reduce((sum, line) => sum + (line.totalTTC ?? 0), 0);
        acc.totalAmount += total;
        if (note.status === "BROUILLON") acc.draftCount += 1;
        if (note.status === "VALIDE") acc.validatedCount += 1;
        if (note.status === "CONTREPASSE") acc.reversedCount += 1;
        return acc;
      },
      { totalAmount: 0, draftCount: 0, validatedCount: 0, reversedCount: 0 },
    );
  }, [filteredCreditNotes]);

  const userOptions = React.useMemo(
    () =>
      Array.from(new Set(visibleNotes.map((note) => note.createdBy))).sort((a, b) =>
        a.localeCompare(b, "fr-FR"),
      ),
    [visibleNotes],
  );

  const partnerOptions = partyType === "client" ? customers : suppliers;

  const locationOptions = React.useMemo(
    () =>
      locations
        .filter((location) => location.active)
        .sort((a, b) => a.name.localeCompare(b.name, "fr-FR")),
    [locations],
  );

  async function openDetail(creditNoteId: string) {
    setBusyId(creditNoteId);
    try {
      const response = await fetch(`/api/credit-notes/${creditNoteId}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as { creditNote?: CreditNote; message?: string };
      if (!response.ok || !body.creditNote) {
        toast.error(body.message ?? "Impossible de charger le detail de l'avoir.");
        return;
      }
      setSelectedDetail(body.creditNote);
      setDetailOpen(true);
    } finally {
      setBusyId(null);
    }
  }

  async function validateDraft(creditNoteId: string) {
    setBusyId(creditNoteId);
    try {
      const response = await fetch(`/api/credit-notes/${creditNoteId}/validate`, {
        method: "POST",
      });
      const body = (await response.json()) as { creditNote?: CreditNote; message?: string };
      if (!response.ok || !body.creditNote) {
        toast.error(body.message ?? "Impossible de valider l'avoir.");
        return;
      }
      onCreditNoteUpdated(body.creditNote);
      toast.success("Avoir valide avec succes.");
    } finally {
      setBusyId(null);
    }
  }

  async function reverseNote(creditNoteId: string) {
    setBusyId(creditNoteId);
    try {
      const response = await fetch(`/api/credit-notes/${creditNoteId}/reverse`, {
        method: "POST",
      });
      const body = (await response.json()) as { creditNote?: CreditNote; message?: string };
      if (!response.ok || !body.creditNote) {
        toast.error(body.message ?? "Impossible de contre-passer l'avoir.");
        return;
      }
      onCreditNoteUpdated(body.creditNote);
      toast.success("Avoir contre-passe avec succes.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Nombre total d'avoirs" value={filteredCreditNotes.length.toString()} icon={Files} />
        <KpiCard label="Montant total" value={formatCurrency(totals.totalAmount)} icon={RefreshCw} />
        <KpiCard label="Brouillons" value={totals.draftCount.toString()} icon={FileClock} />
        <KpiCard label="Valides" value={totals.validatedCount.toString()} icon={FileCheck2} />
        <KpiCard label="Contre-passes" value={totals.reversedCount.toString()} icon={RotateCcw} />
      </div>

      <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
        <CardContent className="space-y-5">
          <div className="grid gap-3 xl:grid-cols-6">
            <Input
              value={filters.search}
              onChange={(event) =>
                setFilters((current) => ({ ...current, search: event.target.value }))
              }
              placeholder={`Rechercher un avoir, un ${partyLabel.toLowerCase()}, un utilisateur...`}
              className="xl:col-span-2"
            />
            <Input
              type="date"
              value={filters.dateFrom}
              onChange={(event) =>
                setFilters((current) => ({ ...current, dateFrom: event.target.value }))
              }
            />
            <Input
              type="date"
              value={filters.dateTo}
              onChange={(event) =>
                setFilters((current) => ({ ...current, dateTo: event.target.value }))
              }
            />
            <Select
              value={filters.partnerId}
              onValueChange={(value) =>
                setFilters((current) => ({ ...current, partnerId: value ?? "all" }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={partyLabel} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous</SelectItem>
                {partnerOptions.map((partner) => (
                <SelectItem key={partner.id} value={partner.id}>
                    {partner.code} - {partner.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.status}
              onValueChange={(value) =>
                setFilters((current) => ({
                  ...current,
                  status: (value ?? "all") as Filters["status"],
                }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Statut" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les statuts</SelectItem>
                <SelectItem value="BROUILLON">Brouillon</SelectItem>
                <SelectItem value="VALIDE">Valide</SelectItem>
                <SelectItem value="CONTREPASSE">Contre-passe</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 xl:grid-cols-[220px_220px_1fr]">
            <Select
              value={filters.user}
              onValueChange={(value) =>
                setFilters((current) => ({ ...current, user: value ?? "all" }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Utilisateur" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les utilisateurs</SelectItem>
                {userOptions.map((userName) => (
                  <SelectItem key={userName} value={userName}>
                    {userName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.locationId}
              onValueChange={(value) =>
                setFilters((current) => ({ ...current, locationId: value ?? "all" }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={stockLabel} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les emplacements</SelectItem>
                {locationOptions.map((location) => (
                  <SelectItem key={location.id} value={location.id}>
                    {location.name} - {location.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <p className="flex items-center text-sm text-muted-foreground">
              {filteredCreditNotes.length} avoir{filteredCreditNotes.length > 1 ? "s" : ""} affiche
              {filteredCreditNotes.length > 1 ? "s" : ""}.
            </p>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>N° avoir</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>{partyLabel}</TableHead>
                  <TableHead className="text-right">Produits</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                  <TableHead>{stockLabel}</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Utilisateur</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCreditNotes.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                      Aucun avoir ne correspond aux filtres selectionnes.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredCreditNotes.map((creditNote) => {
                    const lineCount = creditNote.lines.reduce(
                      (sum, line) => sum + line.quantityReturned,
                      0,
                    );
                    const totalTTC = creditNote.lines.reduce(
                      (sum, line) => sum + (line.totalTTC ?? 0),
                      0,
                    );
                    const partnerName =
                      partyType === "client"
                        ? creditNote.customerName ?? creditNote.customerId ?? "-"
                        : creditNote.supplierName ?? creditNote.supplierId ?? "-";
                    const partnerSecondary =
                      partyType === "client"
                        ? creditNote.invoiceNumber ?? "Sans facture"
                        : creditNote.supplierCode ?? "Sans code";
                    const locationName =
                      partyType === "client"
                        ? creditNote.stockDestinationLocationName ??
                          creditNote.stockDestinationLocationId ??
                          "-"
                        : creditNote.stockSourceLocationName ??
                          creditNote.stockSourceLocationId ??
                          "-";

                    return (
                      <TableRow key={creditNote.id}>
                        <TableCell className="font-medium text-foreground">
                          {creditNote.number}
                        </TableCell>
                        <TableCell>
                          {new Date(creditNote.returnDate).toLocaleDateString("fr-FR")}
                        </TableCell>
                        <TableCell>
                          <div>{partnerName}</div>
                          <div className="text-xs text-muted-foreground">{partnerSecondary}</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{lineCount}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatCurrency(totalTTC)}
                        </TableCell>
                        <TableCell>{locationName}</TableCell>
                        <TableCell>
                          <CreditNoteStatusBadge status={creditNote.status} />
                        </TableCell>
                        <TableCell>{creditNote.createdBy}</TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              disabled={busyId === creditNote.id}
                              onClick={() => openDetail(creditNote.id)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => window.open(`/avoirs/${creditNote.id}`, "_blank")}
                            >
                              <Printer className="h-4 w-4" />
                            </Button>
                            {creditNote.status === "BROUILLON" ? (
                              <>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={busyId === creditNote.id}
                                  onClick={() => onEditDraft(creditNote)}
                                >
                                  Modifier
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={busyId === creditNote.id}
                                  onClick={() => validateDraft(creditNote.id)}
                                >
                                  Valider
                                </Button>
                              </>
                            ) : null}
                            {creditNote.status === "VALIDE" &&
                            (currentUser.role === "admin" || currentUser.role === "depot_manager") ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={busyId === creditNote.id}
                                onClick={() => reverseNote(creditNote.id)}
                              >
                                Contre-passer
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Detail de l&apos;avoir</DialogTitle>
          </DialogHeader>
          {selectedDetail ? <CreditNoteDetailView creditNote={selectedDetail} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KpiCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
      <CardContent className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="font-heading text-2xl font-semibold text-foreground">{value}</p>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function toDateInputValue(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}
