"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { cn, formatCurrency } from "@/lib/utils";
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
  initialDrafts: AccountingEntryDto[];
  reviseEntry: AccountingEntryDto | null;
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
  lines: ManualLineForm[];
};

// The server (manualEntrySchema) still requires a non-empty entry-level
// description; it is never shown to the user or in the Journal, so a fixed
// neutral value is sent. Line "désignations" are stored exactly as typed
// (may be "") - no auto-fill.
const NEUTRAL_ENTRY_DESCRIPTION = "Ecriture manuelle";

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
    lines: [emptyLine(), emptyLine()],
  };
}

function formFromEntry(entry: AccountingEntryDto): ManualEntryForm {
  return {
    date: entry.date.slice(0, 10),
    lines: entry.lines.length
      ? entry.lines.map((line) => ({
          id: crypto.randomUUID(),
          numCompt: line.accountCode,
          label: line.label,
          debit: line.debit ? String(line.debit) : "0",
          credit: line.credit ? String(line.credit) : "0",
        }))
      : [emptyLine(), emptyLine()],
  };
}

/** A stable fingerprint of the form's meaningful content (ignores the
 * client-only row ids and "0" vs "" vs "0.00" noise). Used to tell whether
 * the current form has unsaved changes before navigating between drafts. */
function snapshot(form: ManualEntryForm): string {
  return JSON.stringify({
    date: form.date,
    lines: form.lines.map((line) => ({
      numCompt: line.numCompt.trim(),
      label: line.label.trim(),
      debit: String(Number(line.debit || 0)),
      credit: String(Number(line.credit || 0)),
    })),
  });
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
 * to the server. */
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
  accounts,
  canManage,
  initialDrafts,
  reviseEntry,
}: AccountingEntriesViewProps) {
  const router = useRouter();
  const reviseMode = Boolean(reviseEntry);

  const [saving, setSaving] = React.useState(false);
  const [drafts, setDrafts] = React.useState<AccountingEntryDto[]>(initialDrafts);
  /** null = composing a brand-new (not yet archived) entry. Otherwise the
   * id of the DRAFT AccountingEntry currently loaded in the form. */
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [confirmDeleteActive, setConfirmDeleteActive] = React.useState(false);
  const [form, setForm] = React.useState<ManualEntryForm>(() =>
    reviseEntry ? formFromEntry(reviseEntry) : defaultForm(),
  );
  /** Fingerprint of the form as it was last loaded/saved - the form is
   * "dirty" when the current fingerprint no longer matches. */
  const [loadedSnapshot, setLoadedSnapshot] = React.useState<string>(() =>
    snapshot(reviseEntry ? formFromEntry(reviseEntry) : defaultForm()),
  );
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

  const activeDraftIndex = editingId
    ? drafts.findIndex((draft) => draft.id === editingId)
    : -1;
  const composingNew = editingId === null || activeDraftIndex === -1;
  /** editingId, but null whenever it no longer points at a live draft. */
  const activeDraftId = composingNew ? null : editingId;
  type NavTab = { key: string; position: number; draftId: string | null; isNew: boolean };
  const navTabs: NavTab[] = [
    ...drafts.map((draft, index) => ({
      key: draft.id,
      position: index + 1,
      draftId: draft.id,
      isNew: false,
    })),
    ...(composingNew
      ? [{ key: "__new__", position: drafts.length + 1, draftId: null, isNew: true }]
      : []),
  ];
  const totalPositions = navTabs.length;
  const activePosition = composingNew ? drafts.length + 1 : activeDraftIndex + 1;
  const dirty = snapshot(form) !== loadedSnapshot;

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

    const isLastRow = index === form.lines.length - 1;
    if (isLastRow) {
      addLine(true);
    } else {
      const nextLine = form.lines[index + 1];
      focusRowField(nextLine.id, "numCompt");
    }
  }

  function loadDraft(entry: AccountingEntryDto) {
    const next = formFromEntry(entry);
    setForm(next);
    setEditingId(entry.id);
    rowFieldRefs.current.clear();
    setConfirmDeleteActive(false);
    setLoadedSnapshot(snapshot(next));
  }

  function startNewForm() {
    const next = defaultForm();
    setForm(next);
    setEditingId(null);
    rowFieldRefs.current.clear();
    setConfirmDeleteActive(false);
    setLoadedSnapshot(snapshot(next));
  }

  async function refreshDrafts(): Promise<AccountingEntryDto[]> {
    try {
      const response = await fetch("/api/accounting/entries/drafts", { cache: "no-store" });
      const body = (await response.json()) as { entries?: AccountingEntryDto[] };
      if (response.ok && Array.isArray(body.entries)) {
        setDrafts(body.entries);
        return body.entries;
      }
    } catch {
      /* keep the current list on a transient error */
    }
    return drafts;
  }

  /** Lines to send: only those with a real resolved account. */
  function payloadLines() {
    return meaningfulLines.map((line) => {
      const resolved = resolveAccountByCode(accounts, line.numCompt);
      return {
        accountId: resolved.status === "resolved" ? resolved.account.id : "",
        label: line.label.trim(),
        debit: Number(line.debit || 0),
        credit: Number(line.credit || 0),
      };
    });
  }

  function basePayload() {
    return {
      date: form.date,
      description: NEUTRAL_ENTRY_DESCRIPTION,
      lines: payloadLines(),
    };
  }

  /** Can the current form be saved as a DRAFT without a fight (at least one
   * real line, every account number resolves)? */
  function canPersistCleanly() {
    return meaningfulLines.length >= 1 && unresolvedLines.length === 0;
  }

  function checkBalanced(): boolean {
    if (unresolvedLines.length > 0) {
      toast.error("Certains numéros de compte sont introuvables ou inactifs.");
      return false;
    }
    const eachLineHasOneSide = meaningfulLines.every((line) => {
      const hasDebit = Number(line.debit || 0) > 0;
      const hasCredit = Number(line.credit || 0) > 0;
      return hasDebit !== hasCredit;
    });
    if (
      meaningfulLines.length < 2 ||
      !eachLineHasOneSide ||
      currentDebit <= 0 ||
      !formBalanced
    ) {
      toast.error("L'écriture comptable doit être équilibrée.");
      return false;
    }
    return true;
  }

  function checkDraftMinimum(): boolean {
    if (unresolvedLines.length > 0) {
      toast.error("Certains numéros de compte sont introuvables ou inactifs.");
      return false;
    }
    if (meaningfulLines.length < 1) {
      toast.error("Renseignez au moins une ligne comptable.");
      return false;
    }
    return true;
  }

  /** Before leaving the current form for another tab: silently keep whatever
   * has been typed so no line is lost. An unchanged form, or one that cannot
   * be saved cleanly yet, is left untouched. */
  async function persistCurrentIfDirty(): Promise<AccountingEntryDto[]> {
    if (!canManage || saving || reviseMode) return drafts;
    if (!dirty || !canPersistCleanly()) return drafts;
    setSaving(true);
    try {
      if (activeDraftId) {
        await fetch(`/api/accounting/entries/${activeDraftId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "draft", ...basePayload() }),
        });
      } else {
        await fetch("/api/accounting/entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "DRAFT", ...basePayload() }),
        });
      }
      return await refreshDrafts();
    } catch {
      return drafts;
    } finally {
      setSaving(false);
    }
  }

  async function goToPosition(position: number) {
    if (saving) return;
    const target = navTabs.find((tab) => tab.position === position);
    if (!target || target.position === activePosition) return;
    const targetDraftId = target.draftId;
    const fresh = await persistCurrentIfDirty();
    if (targetDraftId === null) {
      startNewForm();
      return;
    }
    const entry =
      fresh.find((draft) => draft.id === targetDraftId) ??
      drafts.find((draft) => draft.id === targetDraftId);
    if (entry) loadDraft(entry);
    else startNewForm();
  }

  async function startNewEntry() {
    if (saving) return;
    await persistCurrentIfDirty();
    startNewForm();
  }

  async function saveDraft() {
    if (!canManage || saving || !checkDraftMinimum()) return;
    setSaving(true);
    try {
      const response = activeDraftId
        ? await fetch(`/api/accounting/entries/${activeDraftId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "draft", ...basePayload() }),
          })
        : await fetch("/api/accounting/entries", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "DRAFT", ...basePayload() }),
          });
      const body = (await response.json()) as { entry?: AccountingEntryDto; message?: string };
      if (!response.ok || !body.entry) {
        toast.error(body.message ?? "Impossible d'archiver l'écriture.");
        return;
      }
      toast.success(activeDraftId ? "Écriture non validée mise à jour." : "Écriture archivée.");
      const savedId = body.entry.id;
      const fresh = await refreshDrafts();
      const saved = fresh.find((draft) => draft.id === savedId);
      if (saved) loadDraft(saved);
      else startNewForm();
    } finally {
      setSaving(false);
    }
  }

  async function validateFromForm() {
    if (!canManage || saving || !checkBalanced()) return;
    setSaving(true);
    try {
      let removedDraftId: string | null = null;
      if (activeDraftId) {
        const patch = await fetch(`/api/accounting/entries/${activeDraftId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "draft", ...basePayload() }),
        });
        const patchBody = (await patch.json()) as { message?: string };
        if (!patch.ok) {
          toast.error(patchBody.message ?? "Impossible de mettre à jour l'écriture non validée.");
          return;
        }
        const validate = await fetch(`/api/accounting/entries/${activeDraftId}/validate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        const validateBody = (await validate.json()) as { message?: string };
        if (!validate.ok) {
          toast.error(validateBody.message ?? "Impossible de valider l'écriture non validée.");
          return;
        }
        removedDraftId = activeDraftId;
      } else {
        const response = await fetch("/api/accounting/entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "POSTED", ...basePayload() }),
        });
        const body = (await response.json()) as { entry?: AccountingEntryDto; message?: string };
        if (!response.ok || !body.entry) {
          toast.error(body.message ?? "Impossible de créer l'écriture.");
          return;
        }
      }
      toast.success("Écriture validée : elle apparaît dans le Journal.");
      const before = drafts;
      const fresh = await refreshDrafts();
      if (removedDraftId) {
        if (fresh.length === 0) {
          startNewForm();
        } else {
          const oldIndex = Math.max(0, before.findIndex((draft) => draft.id === removedDraftId));
          loadDraft(fresh[Math.min(oldIndex, fresh.length - 1)]);
        }
      } else {
        startNewForm();
      }
    } finally {
      setSaving(false);
    }
  }

  async function submitRevision() {
    if (!canManage || saving || !reviseEntry || !checkBalanced()) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/accounting/entries/${reviseEntry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "revise", ...basePayload() }),
      });
      const body = (await response.json()) as { entry?: AccountingEntryDto; message?: string };
      if (!response.ok || !body.entry) {
        toast.error(body.message ?? "Impossible d'enregistrer la correction.");
        return;
      }
      toast.success("Correction enregistrée : l'écriture d'origine a été contre-passée.");
      router.push("/comptabilite/journal");
    } finally {
      setSaving(false);
    }
  }

  async function deleteActiveDraft() {
    if (!activeDraftId || saving) return;
    const removedId = activeDraftId;
    setSaving(true);
    try {
      const response = await fetch(`/api/accounting/entries/${removedId}`, { method: "DELETE" });
      const body = (await response.json()) as { message?: string };
      if (!response.ok) {
        toast.error(body.message ?? "Impossible de supprimer cette écriture.");
        return;
      }
      toast.success("Écriture non validée supprimée.");
      setConfirmDeleteActive(false);
      const before = drafts;
      const fresh = await refreshDrafts();
      if (fresh.length === 0) {
        startNewForm();
      } else {
        const oldIndex = Math.max(0, before.findIndex((draft) => draft.id === removedId));
        loadDraft(fresh[Math.min(oldIndex, fresh.length - 1)]);
      }
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

  const draftNav = (
    <div className="rounded-2xl border border-border bg-card px-4 py-3 shadow-[0_10px_30px_rgba(15,23,42,0.06)] lg:px-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="shrink-0"
            disabled={saving || activePosition <= 1}
            onClick={() => void goToPosition(activePosition - 1)}
            aria-label="Écriture précédente"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <div className="flex items-center gap-1 overflow-x-auto">
            {navTabs.map((tab) => {
              const active = tab.position === activePosition;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => void goToPosition(tab.position)}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "h-9 min-w-9 shrink-0 rounded-xl px-3 text-sm font-semibold tabular-nums transition-colors",
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-muted text-muted-foreground hover:bg-muted/70",
                    tab.isNew && !active && "border border-dashed border-border bg-transparent",
                  )}
                >
                  {tab.position}
                </button>
              );
            })}
          </div>

          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="shrink-0"
            disabled={saving || activePosition >= totalPositions}
            onClick={() => void goToPosition(activePosition + 1)}
            aria-label="Écriture suivante"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 sm:ml-auto"
          disabled={saving || (composingNew && !dirty)}
          onClick={() => void startNewEntry()}
        >
          <Plus className="h-4 w-4" />
          Nouvelle écriture
        </Button>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        {composingNew
          ? "Nouvelle écriture en cours — « Archiver » pour la garder sans la comptabiliser."
          : `Écriture non validée ${activePosition} / ${drafts.length} — absente du Journal tant qu'elle n'est pas validée.`}
      </p>
    </div>
  );

  const linesEditor = (
    <>
      <div className="space-y-1.5 sm:max-w-xs">
        <Label htmlFor="entry-date">Date</Label>
        <Input
          id="entry-date"
          type="date"
          value={form.date}
          onChange={(event) => setForm((prev) => ({ ...prev, date: event.target.value }))}
          className="h-11"
        />
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
                        placeholder="Facultatif"
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

        <div className="flex flex-wrap items-center gap-2">
          {reviseMode ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="lg"
                disabled={saving}
                onClick={() => router.push("/comptabilite/journal")}
              >
                Annuler
              </Button>
              <Button type="button" size="lg" disabled={saving} onClick={submitRevision}>
                {saving ? "Enregistrement..." : "Enregistrer la correction"}
              </Button>
            </>
          ) : confirmDeleteActive ? (
            <>
              <span className="text-sm text-muted-foreground">
                Supprimer cette écriture non validée ?
              </span>
              <Button
                type="button"
                variant="destructive"
                size="lg"
                disabled={saving}
                onClick={() => void deleteActiveDraft()}
              >
                Supprimer
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="lg"
                disabled={saving}
                onClick={() => setConfirmDeleteActive(false)}
              >
                Annuler
              </Button>
            </>
          ) : (
            <>
              {activeDraftId ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="lg"
                  disabled={saving}
                  onClick={() => setConfirmDeleteActive(true)}
                >
                  <Trash2 className="h-4 w-4" />
                  Supprimer cette écriture
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="lg"
                disabled={saving}
                onClick={saveDraft}
              >
                Archiver
              </Button>
              <Button type="button" size="lg" disabled={saving} onClick={validateFromForm}>
                {saving ? "Enregistrement..." : "Valider l'écriture"}
              </Button>
            </>
          )}
        </div>
      </div>
    </>
  );

  return (
    <div className="space-y-6">
      {reviseMode ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">
            Correction de l&apos;écriture {reviseEntry?.entryNumber}
          </p>
          <p>
            En enregistrant, la version actuelle sera contre-passée (elle reste dans le
            Journal, marquée REVERSED) et cette version corrigée sera comptabilisée.
          </p>
        </div>
      ) : (
        draftNav
      )}

      <div className="rounded-2xl border border-border bg-card p-5 shadow-[0_10px_30px_rgba(15,23,42,0.06)] lg:p-7">
        {linesEditor}
      </div>
    </div>
  );
}
