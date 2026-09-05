"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { formatCurrency } from "@/lib/utils";
import type {
  AccountingAccountOptionDto,
  AccountingEntryDto,
} from "@/types/accounting";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  lines: ManualLineForm[];
};

type ResolvedAccount =
  | { status: "empty" }
  | { status: "not-found" }
  | { status: "inactive"; account: AccountingAccountOptionDto }
  | { status: "resolved"; account: AccountingAccountOptionDto };

type LineField = "numCompt" | "label" | "debit" | "credit";

function emptyLine(): ManualLineForm {
  return { id: crypto.randomUUID(), numCompt: "", label: "", debit: "0", credit: "0" };
}

function defaultForm(): ManualEntryForm {
  return {
    date: new Date().toISOString().slice(0, 10),
    reference: "",
    description: "",
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

export function AccountingEntriesView({ accounts, canManage }: AccountingEntriesViewProps) {
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
  // time this effect runs (always after commit) the ref is populated.
  React.useEffect(() => {
    const id = pendingFocusRowIdRef.current;
    if (!id) return;
    pendingFocusRowIdRef.current = null;
    focusRowField(id, "numCompt");
  }, [form.lines]);

  const meaningfulLines = React.useMemo(
    () => form.lines.filter(isLineMeaningful),
    [form.lines],
  );
  const currentDebit = meaningfulLines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
  const currentCredit = meaningfulLines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
  const ecart = currentDebit - currentCredit;
  const formBalanced = Math.abs(ecart) < 0.001;
  const unresolvedLines = meaningfulLines.filter(
    (line) => resolveAccountByCode(accounts, line.numCompt).status !== "resolved",
  );

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

  function resetForm() {
    setForm(defaultForm());
    rowFieldRefs.current.clear();
  }

  async function handleCreateEntry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || saving) return;

    if (meaningfulLines.length < 2 || !formBalanced || currentDebit <= 0) {
      toast.error("L'écriture comptable doit être équilibrée.");
      return;
    }
    if (unresolvedLines.length > 0) {
      toast.error("Certains numéros de compte sont introuvables ou inactifs.");
      return;
    }
    if (!form.description.trim()) {
      toast.error("Le libellé général est obligatoire.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/accounting/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: form.date,
          reference: form.reference || null,
          description: form.description,
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
        toast.error(result.message ?? "Impossible de créer l'écriture.");
        return;
      }

      toast.success("Écriture enregistrée avec succès.");
      resetForm();
    } finally {
      setSaving(false);
    }
  }

  if (!canManage) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
        <p className="text-sm text-muted-foreground">
          La saisie d&apos;écritures manuelles est réservée aux administrateurs. Les
          mouvements comptables restent consultables dans Comptabilité → Journal.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleCreateEntry}
      className="rounded-2xl border border-border bg-card p-5 shadow-[0_10px_30px_rgba(15,23,42,0.06)] lg:p-7"
    >
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="entry-date">Date</Label>
          <Input
            id="entry-date"
            type="date"
            value={form.date}
            onChange={(event) => setForm((prev) => ({ ...prev, date: event.target.value }))}
            className="h-11"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="entry-reference">Référence</Label>
          <Input
            id="entry-reference"
            value={form.reference}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, reference: event.target.value }))
            }
            placeholder="FACT-39060"
            className="h-11"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="entry-description">Libellé général</Label>
          <Input
            id="entry-description"
            value={form.description}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, description: event.target.value }))
            }
            placeholder="Régularisation / écriture diverse"
            className="h-11"
          />
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-border">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-2">
          <p className="text-sm text-muted-foreground">
            Tapez le numéro de compte puis Entrée pour passer au champ suivant. Une ligne
            porte soit un débit, soit un crédit.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => addLine(false)}>
            <Plus className="h-4 w-4" />
            Ajouter une ligne
          </Button>
        </div>

        <div className="overflow-x-auto">
          <Table className="min-w-[720px] table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[14%]">N° compte</TableHead>
                <TableHead className="w-[28%]">Désignation</TableHead>
                <TableHead className="w-[30%]">Nom du compte</TableHead>
                <TableHead className="w-[13%] text-right">Débit</TableHead>
                <TableHead className="w-[13%] text-right">Crédit</TableHead>
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
                        onChange={(event) => updateLine(index, "numCompt", event.target.value)}
                        onKeyDown={(event) => handleLineKeyDown(index, "numCompt", event)}
                        aria-invalid={isInvalid}
                        placeholder="Ex: 51111"
                        className="h-11 font-medium tabular-nums"
                      />
                    </TableCell>
                    <TableCell className="p-1.5 align-top">
                      <Input
                        ref={(node) => setRowRef(line.id, "label", node)}
                        value={line.label}
                        onChange={(event) => updateLine(index, "label", event.target.value)}
                        onKeyDown={(event) => handleLineKeyDown(index, "label", event)}
                        placeholder="Désignation de la ligne"
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
      </div>

      <div className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="w-full max-w-xs space-y-1.5 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Total débit</span>
            <span className="font-semibold tabular-nums">{formatCurrency(currentDebit)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Total crédit</span>
            <span className="font-semibold tabular-nums">{formatCurrency(currentCredit)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-border pt-1.5">
            <span className="text-muted-foreground">Écart</span>
            <span
              className={
                "font-semibold tabular-nums " +
                (formBalanced ? "text-emerald-600" : "text-destructive")
              }
            >
              {formatCurrency(Math.abs(ecart))}
            </span>
          </div>
          {unresolvedLines.length > 0 ? (
            <Badge variant="destructive" className="mt-1">
              {unresolvedLines.length} compte{unresolvedLines.length > 1 ? "s" : ""} introuvable
              {unresolvedLines.length > 1 ? "s" : ""}
            </Badge>
          ) : null}
        </div>

        <Button type="submit" size="lg" disabled={saving}>
          {saving ? "Enregistrement..." : "Valider l'écriture"}
        </Button>
      </div>
    </form>
  );
}
