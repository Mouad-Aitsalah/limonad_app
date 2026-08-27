"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  accountingJournalTypeLabels,
  accountingSourceTypeLabels,
} from "@/lib/accounting";
import { formatCurrency } from "@/lib/utils";
import type {
  AccountingAccountOptionDto,
  AccountingEntryDto,
  AccountingJournalType,
} from "@/types/accounting";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type AccountingEntriesViewProps = {
  initialEntries: AccountingEntryDto[];
  accounts: AccountingAccountOptionDto[];
  canManage: boolean;
};

type ManualLineForm = {
  /** Stable client-only key - never derived from field content, so typing
   * in one field never remounts (and never drops focus on) another. */
  id: string;
  numCompt: string;
  label: string;
  debit: string;
  credit: string;
};

type ManualEntryForm = {
  date: string;
  reference: string;
  description: string;
  journalType: AccountingJournalType;
  lines: ManualLineForm[];
};

type ResolvedAccount =
  | { status: "empty" }
  | { status: "not-found" }
  | { status: "inactive"; account: AccountingAccountOptionDto }
  | { status: "resolved"; account: AccountingAccountOptionDto };

type LineField = "numCompt" | "label" | "debit" | "credit";

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("fr-FR");
}

function emptyLine(): ManualLineForm {
  return { id: crypto.randomUUID(), numCompt: "", label: "", debit: "0", credit: "0" };
}

function defaultForm(): ManualEntryForm {
  return {
    date: new Date().toISOString().slice(0, 10),
    reference: "",
    description: "",
    journalType: "MANUAL",
    lines: [emptyLine(), emptyLine()],
  };
}

function isLineMeaningful(line: ManualLineForm) {
  return (
    line.numCompt.trim() !== "" ||
    line.label.trim() !== "" ||
    Number(line.debit || 0) > 0 ||
    Number(line.credit || 0) > 0
  );
}

/** The account number is only ever a search key into the real chart of
 * accounts - the resolved AccountingAccount.id is what actually gets sent
 * to the server, exactly like the previous select-based flow did. */
function resolveAccountByCode(
  accounts: AccountingAccountOptionDto[],
  rawCode: string,
): ResolvedAccount {
  const normalized = rawCode.trim().toUpperCase();
  if (!normalized) return { status: "empty" };
  const match = accounts.find((account) => account.code.trim().toUpperCase() === normalized);
  if (!match) return { status: "not-found" };
  if (!match.isActive) return { status: "inactive", account: match };
  return { status: "resolved", account: match };
}

export function AccountingEntriesView({
  initialEntries,
  accounts,
  canManage,
}: AccountingEntriesViewProps) {
  const [entries, setEntries] = React.useState(initialEntries);
  const [search, setSearch] = React.useState("");
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState<ManualEntryForm>(defaultForm);
  const pendingFocusRowIdRef = React.useRef<string | null>(null);

  const rowFieldRefs = React.useRef(
    new Map<string, Record<LineField, HTMLInputElement | null>>(),
  );

  function getRowRefs(id: string) {
    let entry = rowFieldRefs.current.get(id);
    if (!entry) {
      entry = { numCompt: null, label: null, debit: null, credit: null };
      rowFieldRefs.current.set(id, entry);
    }
    return entry;
  }

  function setRowRef(id: string, field: LineField, node: HTMLInputElement | null) {
    getRowRefs(id)[field] = node;
  }

  function focusRowField(id: string, field: LineField) {
    const node = rowFieldRefs.current.get(id)?.[field];
    node?.focus();
    node?.select();
  }

  // A new row created after pressing Enter in "Credit" mounts a brand new
  // DOM node in the same render that appends it to form.lines, so by the
  // time this effect runs (always after commit) the ref is populated - no
  // portal/animation timing race is involved here (unlike a dialog's own
  // opening focus), so a plain effect reliably picks it up.
  React.useEffect(() => {
    const id = pendingFocusRowIdRef.current;
    if (!id) return;
    pendingFocusRowIdRef.current = null;
    focusRowField(id, "numCompt");
  }, [form.lines]);

  const filteredEntries = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (!query) return true;
      return [
        entry.entryNumber,
        entry.reference ?? "",
        entry.description,
        entry.createdByUserName ?? "",
        ...entry.lines.flatMap((line) => [line.accountCode, line.accountName, line.label]),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [entries, search]);

  const totalDebit = filteredEntries.reduce((sum, entry) => sum + entry.totalDebit, 0);
  const totalCredit = filteredEntries.reduce((sum, entry) => sum + entry.totalCredit, 0);

  const meaningfulLines = React.useMemo(
    () => form.lines.filter(isLineMeaningful),
    [form.lines],
  );
  const currentDebit = meaningfulLines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
  const currentCredit = meaningfulLines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
  const formBalanced = Math.abs(currentDebit - currentCredit) < 0.001;
  const unresolvedLines = meaningfulLines.filter(
    (line) => resolveAccountByCode(accounts, line.numCompt).status !== "resolved",
  );
  const canSubmit =
    !saving && formBalanced && meaningfulLines.length >= 2 && unresolvedLines.length === 0;

  function updateLine(index: number, field: keyof ManualLineForm, value: string) {
    setForm((prev) => ({
      ...prev,
      lines: prev.lines.map((line, lineIndex) =>
        lineIndex === index ? { ...line, [field]: value } : line,
      ),
    }));
  }

  function updateDebit(index: number, value: string) {
    setForm((prev) => ({
      ...prev,
      lines: prev.lines.map((line, lineIndex) =>
        lineIndex === index
          ? { ...line, debit: value, credit: Number(value) > 0 ? "0" : line.credit }
          : line,
      ),
    }));
  }

  function updateCredit(index: number, value: string) {
    setForm((prev) => ({
      ...prev,
      lines: prev.lines.map((line, lineIndex) =>
        lineIndex === index
          ? { ...line, credit: value, debit: Number(value) > 0 ? "0" : line.debit }
          : line,
      ),
    }));
  }

  function addLine(focusNewRow: boolean) {
    const nextLine = emptyLine();
    setForm((prev) => ({ ...prev, lines: [...prev.lines, nextLine] }));
    if (focusNewRow) pendingFocusRowIdRef.current = nextLine.id;
  }

  function removeLine(index: number) {
    setForm((prev) => ({
      ...prev,
      lines: prev.lines.length > 2 ? prev.lines.filter((_, i) => i !== index) : prev.lines,
    }));
  }

  function handleLineKeyDown(index: number, field: LineField, event: React.KeyboardEvent) {
    if (event.key !== "Enter") return;
    event.preventDefault();

    const line = form.lines[index];
    if (!line) return;

    if (field === "numCompt") {
      focusRowField(line.id, "label");
      return;
    }
    if (field === "label") {
      focusRowField(line.id, "debit");
      return;
    }
    if (field === "debit") {
      focusRowField(line.id, "credit");
      return;
    }

    // field === "credit": finish this line, then move to (or create) the next.
    const isLastRow = index === form.lines.length - 1;
    if (isLastRow) {
      addLine(true);
    } else {
      const nextLine = form.lines[index + 1];
      focusRowField(nextLine.id, "numCompt");
    }
  }

  function resetDialog() {
    setForm(defaultForm());
    rowFieldRefs.current.clear();
    setDialogOpen(false);
  }

  async function handleCreateEntry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || !canSubmit) return;

    setSaving(true);
    try {
      const response = await fetch("/api/accounting/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: form.date,
          reference: form.reference || null,
          description: form.description,
          journalType: form.journalType,
          lines: meaningfulLines.map((line) => {
            const resolved = resolveAccountByCode(accounts, line.numCompt);
            return {
              accountId: resolved.status === "resolved" ? resolved.account.id : "",
              label: line.label,
              debit: Number(line.debit || 0),
              credit: Number(line.credit || 0),
            };
          }),
        }),
      });
      const result = (await response.json()) as {
        entry?: AccountingEntryDto;
        message?: string;
      };
      if (!response.ok || !result.entry) {
        toast.error(result.message ?? "Impossible de creer l'ecriture.");
        return;
      }

      setEntries((prev) => [result.entry!, ...prev]);
      toast.success("Ecriture comptable enregistree.");
      resetDialog();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
          <p className="text-sm text-muted-foreground">Ecritures affichees</p>
          <p className="mt-2 text-2xl font-semibold">{filteredEntries.length}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
          <p className="text-sm text-muted-foreground">Total debit</p>
          <p className="mt-2 text-2xl font-semibold">{formatCurrency(totalDebit)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
          <p className="text-sm text-muted-foreground">Total credit</p>
          <p className="mt-2 text-2xl font-semibold">{formatCurrency(totalCredit)}</p>
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Rechercher une reference, un compte, un libelle..."
          className="lg:max-w-sm"
        />

        {canManage && (
          <Dialog
            open={dialogOpen}
            onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) resetDialog();
            }}
          >
            <DialogTrigger render={<Button type="button" size="lg" />}>
              <Plus className="h-4 w-4" />
              Nouvelle ecriture
            </DialogTrigger>
            <DialogContent className="flex max-h-[92vh] w-full flex-col overflow-hidden sm:max-w-[88vw]">
              <DialogHeader>
                <DialogTitle>Nouvelle ecriture manuelle</DialogTitle>
                <DialogDescription>
                  Tapez le numero de compte puis Entree pour naviguer sans la souris. Le
                  serveur refusera toute ecriture non equilibree.
                </DialogDescription>
              </DialogHeader>

              <form
                onSubmit={handleCreateEntry}
                className="flex flex-1 flex-col gap-3 overflow-hidden"
              >
                <div className="grid shrink-0 gap-3 md:grid-cols-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="entry-date">Date</Label>
                    <Input
                      id="entry-date"
                      type="date"
                      value={form.date}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, date: event.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="entry-reference">Reference</Label>
                    <Input
                      id="entry-reference"
                      value={form.reference}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, reference: event.target.value }))
                      }
                      placeholder="FACT-39060"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="entry-journal">Journal</Label>
                    <select
                      id="entry-journal"
                      value={form.journalType}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          journalType: event.target.value as AccountingJournalType,
                        }))
                      }
                      className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none"
                    >
                      {Object.entries(accountingJournalTypeLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="entry-description">Description</Label>
                    <Input
                      id="entry-description"
                      value={form.description}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, description: event.target.value }))
                      }
                      placeholder="Vente client / regularisation / ecriture diverse"
                    />
                  </div>
                </div>

                <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-border">
                  <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
                    <p className="text-sm text-muted-foreground">
                      Une ligne ne peut pas porter debit et credit en meme temps.
                    </p>
                    <Button type="button" variant="outline" size="sm" onClick={() => addLine(false)}>
                      <Plus className="h-4 w-4" />
                      Ajouter une ligne
                    </Button>
                  </div>

                  <div className="flex-1 overflow-y-auto">
                    <Table className="table-fixed">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[15%]">NumCompt</TableHead>
                          <TableHead className="w-[30%]">Designation</TableHead>
                          <TableHead className="w-[30%]">Nom_compte</TableHead>
                          <TableHead className="w-[12.5%] text-right">Debit</TableHead>
                          <TableHead className="w-[12.5%] text-right">Credit</TableHead>
                          <TableHead className="w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {form.lines.map((line, index) => {
                          const resolved = resolveAccountByCode(accounts, line.numCompt);
                          const nameDisplay =
                            resolved.status === "resolved" || resolved.status === "inactive"
                              ? resolved.account.name +
                                (resolved.status === "inactive" ? " (inactif)" : "")
                              : resolved.status === "not-found"
                                ? "Compte introuvable"
                                : "";
                          const isInvalid =
                            resolved.status === "not-found" || resolved.status === "inactive";

                          return (
                            <TableRow key={line.id}>
                              <TableCell className="p-1.5 align-top">
                                <Input
                                  ref={(node) => setRowRef(line.id, "numCompt", node)}
                                  value={line.numCompt}
                                  onChange={(event) =>
                                    updateLine(index, "numCompt", event.target.value)
                                  }
                                  onKeyDown={(event) =>
                                    handleLineKeyDown(index, "numCompt", event)
                                  }
                                  aria-invalid={isInvalid}
                                  placeholder="Ex: 516100"
                                  className="h-11 font-medium tabular-nums"
                                />
                              </TableCell>
                              <TableCell className="p-1.5 align-top">
                                <Input
                                  ref={(node) => setRowRef(line.id, "label", node)}
                                  value={line.label}
                                  onChange={(event) =>
                                    updateLine(index, "label", event.target.value)
                                  }
                                  onKeyDown={(event) => handleLineKeyDown(index, "label", event)}
                                  placeholder="Designation de la ligne"
                                  className="h-11"
                                />
                              </TableCell>
                              <TableCell className="p-1.5 align-top">
                                <Input
                                  readOnly
                                  tabIndex={-1}
                                  value={nameDisplay}
                                  placeholder="—"
                                  className={
                                    "h-11 cursor-default bg-muted/40 " +
                                    (isInvalid ? "text-destructive" : "text-muted-foreground")
                                  }
                                />
                              </TableCell>
                              <TableCell className="p-1.5 align-top">
                                <Input
                                  ref={(node) => setRowRef(line.id, "debit", node)}
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={line.debit}
                                  onFocus={(event) => event.currentTarget.select()}
                                  onChange={(event) => updateDebit(index, event.target.value)}
                                  onKeyDown={(event) => handleLineKeyDown(index, "debit", event)}
                                  className="h-11 text-right tabular-nums"
                                />
                              </TableCell>
                              <TableCell className="p-1.5 align-top">
                                <Input
                                  ref={(node) => setRowRef(line.id, "credit", node)}
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={line.credit}
                                  onFocus={(event) => event.currentTarget.select()}
                                  onChange={(event) => updateCredit(index, event.target.value)}
                                  onKeyDown={(event) => handleLineKeyDown(index, "credit", event)}
                                  className="h-11 text-right tabular-nums"
                                />
                              </TableCell>
                              <TableCell className="p-1.5 align-top">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => removeLine(index)}
                                  aria-label="Supprimer la ligne"
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

                  <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-border bg-muted/50 px-3 py-2.5 text-sm">
                    <span>Total debit : {formatCurrency(currentDebit)}</span>
                    <span>Total credit : {formatCurrency(currentCredit)}</span>
                    <Badge variant={formBalanced ? "secondary" : "destructive"}>
                      {formBalanced ? "Equilibree" : "Non equilibree"}
                    </Badge>
                    {unresolvedLines.length > 0 ? (
                      <Badge variant="destructive">
                        {unresolvedLines.length} compte
                        {unresolvedLines.length > 1 ? "s" : ""} introuvable
                        {unresolvedLines.length > 1 ? "s" : ""}
                      </Badge>
                    ) : null}
                  </div>
                </div>

                <DialogFooter className="shrink-0">
                  <Button type="button" variant="outline" onClick={resetDialog} disabled={saving}>
                    Annuler
                  </Button>
                  <Button type="submit" disabled={!canSubmit}>
                    {saving ? "Enregistrement..." : "Valider l'ecriture"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="space-y-4">
        {filteredEntries.map((entry) => (
          <div
            key={entry.id}
            className="rounded-xl border border-border bg-card shadow-[0_10px_30px_rgba(15,23,42,0.06)]"
          >
            <div className="flex flex-col gap-3 border-b border-border px-4 py-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Ecriture</p>
                <h3 className="font-heading text-lg font-semibold text-foreground">
                  REF : {entry.reference ?? entry.entryNumber}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {formatDate(entry.date)} • {entry.description}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{accountingJournalTypeLabels[entry.journalType]}</Badge>
                <Badge variant={entry.status === "POSTED" ? "secondary" : "outline"}>
                  {entry.status}
                </Badge>
                {entry.sourceType && (
                  <Badge variant="outline">{accountingSourceTypeLabels[entry.sourceType]}</Badge>
                )}
              </div>
            </div>

            <div className="p-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Compte</TableHead>
                    <TableHead>Libelle</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entry.lines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{line.accountCode}</span>
                          <span className="text-xs text-muted-foreground">{line.accountName}</span>
                        </div>
                      </TableCell>
                      <TableCell>{line.label}</TableCell>
                      <TableCell className="text-right">
                        {line.debit > 0 ? formatCurrency(line.debit) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {line.credit > 0 ? formatCurrency(line.credit) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/50 px-4 py-3 text-sm">
                <div className="text-muted-foreground">
                  {entry.createdByUserName
                    ? `Saisi par ${entry.createdByUserName}`
                    : "Ecriture systeme"}
                </div>
                <div className="flex flex-wrap gap-4 font-medium">
                  <span>Total debit : {formatCurrency(entry.totalDebit)}</span>
                  <span>Total credit : {formatCurrency(entry.totalCredit)}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
