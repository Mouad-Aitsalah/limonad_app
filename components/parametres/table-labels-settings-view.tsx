"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Save, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { SettingsNav } from "@/components/parametres/settings-nav";
import { useTableLabelsContext } from "@/components/table-labels/table-labels-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionCard } from "@/components/ui/section-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TABLE_LABEL_MAX_LENGTH, type PageTableLabels, type TableLabels } from "@/lib/table-labels/labels";
import { pageTableColumns, TABLE_COLUMNS, TABLE_PAGES, type TablePage } from "@/lib/table-labels/registry";

/** The form state of one page: { [table]: { [column]: text typed (may be "") } }. */
type Draft = Record<string, Record<string, string>>;

function draftOf(page: TablePage, labels: TableLabels): Draft {
  const saved = labels[page.key] ?? {};
  return Object.fromEntries(
    page.tables.map((pageTable) => [
      pageTable.table,
      Object.fromEntries(pageTableColumns(pageTable).map(({ key }) => [key, saved[pageTable.table]?.[key] ?? ""])),
    ]),
  );
}

function sameDraft(a: Draft, b: Draft) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Paramètres -> Personnalisation des tableaux (admin only - the page loader and
 * the API both refuse any other role). Pick a page, rename the columns of its
 * tables; each page has its own configuration. Empty field = default label.
 */
export function TableLabelsSettingsView({ initialLabels }: { initialLabels: TableLabels }) {
  const router = useRouter();
  const { setLabels: publishLabels } = useTableLabelsContext();
  const [labels, setLabels] = React.useState<TableLabels>(initialLabels);
  const [pageKey, setPageKey] = React.useState<string>(TABLE_PAGES[0].key);
  const page = (TABLE_PAGES as readonly TablePage[]).find((item) => item.key === pageKey) ?? TABLE_PAGES[0];
  const savedDraft = React.useMemo(() => draftOf(page, labels), [page, labels]);
  const [draft, setDraft] = React.useState<Draft>(savedDraft);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmation, setConfirmation] = React.useState<string | null>(null);
  const dirty = !sameDraft(draft, savedDraft);
  const fieldId = React.useId();

  function changePage(next: string | null) {
    if (!next || next === pageKey) return;
    if (dirty && !window.confirm("Les modifications non enregistrées de cette page seront perdues. Continuer ?")) return;
    const nextPage = (TABLE_PAGES as readonly TablePage[]).find((item) => item.key === next);
    if (!nextPage) return;
    setPageKey(next);
    setDraft(draftOf(nextPage, labels));
    setError(null);
    setConfirmation(null);
  }

  function setField(table: string, column: string, value: string) {
    setDraft((current) => ({ ...current, [table]: { ...current[table], [column]: value } }));
    setConfirmation(null);
  }

  /** Every field emptied = every column back to its default label (saved with « Enregistrer »). */
  function resetToDefaults() {
    setDraft(Object.fromEntries(Object.entries(draft).map(([table, columns]) => [table, Object.fromEntries(Object.keys(columns).map((key) => [key, ""]))])));
    setConfirmation(null);
  }

  function cancelChanges() {
    setDraft(savedDraft);
    setError(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const pageLabels: PageTableLabels = Object.fromEntries(
        Object.entries(draft).map(([table, columns]) => [
          table,
          Object.fromEntries(Object.entries(columns).filter(([, value]) => value.trim() !== "")),
        ]),
      );
      const response = await fetch("/api/organization/table-labels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page: page.key, labels: pageLabels }),
      });
      const body = (await response.json().catch(() => ({}))) as { labels?: TableLabels; message?: string };
      if (!response.ok || !body.labels) {
        setError(body.message ?? "Enregistrement impossible.");
        return;
      }
      setLabels(body.labels);
      setDraft(draftOf(page, body.labels));
      publishLabels(body.labels);
      router.refresh();
      const message = `Intitulés enregistrés pour la page « ${page.label} ».`;
      setConfirmation(message);
      toast.success(message);
    } catch {
      setError("Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <SettingsNav />

      <SectionCard>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="w-full max-w-sm space-y-2">
            <Label htmlFor={fieldId}>Page à personnaliser</Label>
            <Select value={pageKey} onValueChange={changePage}>
              <SelectTrigger id={fieldId} className="w-full">
                <SelectValue>
                  {(value: string | null) => TABLE_PAGES.find((item) => item.key === value)?.label ?? "Sélectionner"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {TABLE_PAGES.map((item) => (
                  <SelectItem key={item.key} value={item.key}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={cancelChanges} disabled={!dirty || saving}>
              <Undo2 aria-hidden="true" className="h-4 w-4" />
              Annuler les modifications
            </Button>
            <Button type="button" variant="outline" onClick={resetToDefaults} disabled={saving}>
              <RotateCcw aria-hidden="true" className="h-4 w-4" />
              Réinitialiser les intitulés par défaut
            </Button>
            <Button type="button" onClick={() => void save()} disabled={!dirty || saving}>
              <Save aria-hidden="true" className="h-4 w-4" />
              {saving ? "Enregistrement..." : "Enregistrer"}
            </Button>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Les intitulés s&apos;appliquent à cette page uniquement, pour tous les utilisateurs de l&apos;organisation. Un
          champ vide = l&apos;intitulé par défaut. Aucune donnée n&apos;est modifiée.
        </p>
        {confirmation ? (
          <p role="status" className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {confirmation}
          </p>
        ) : null}
        {dirty && !confirmation ? (
          <p className="mt-3 text-xs font-medium text-amber-700">Modifications non enregistrées.</p>
        ) : null}
        {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      </SectionCard>

      {page.tables.map((pageTable) => (
        <SectionCard key={pageTable.table} title={TABLE_COLUMNS[pageTable.table].label} contentClassName="space-y-2">
          <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)] gap-3 px-1 text-xs font-semibold text-muted-foreground sm:grid">
            <span>Intitulé par défaut</span>
            <span>Intitulé actuel</span>
            <span>Intitulé personnalisé</span>
          </div>
          {pageTableColumns(pageTable).map(({ key, defaultLabel }) => {
            const saved = labels[page.key]?.[pageTable.table]?.[key];
            const inputId = `${fieldId}-${pageTable.table}-${key}`;
            return (
              <div
                key={key}
                data-column={`${pageTable.table}.${key}`}
                className="grid gap-1.5 rounded-xl border border-border/70 p-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)] sm:items-center sm:gap-3 sm:border-0 sm:p-1"
              >
                <span className="text-sm text-muted-foreground">{defaultLabel}</span>
                <span className="text-sm font-medium text-foreground">{saved ?? defaultLabel}</span>
                <Input
                  id={inputId}
                  aria-label={`Intitulé personnalisé de la colonne ${defaultLabel}`}
                  value={draft[pageTable.table]?.[key] ?? ""}
                  maxLength={TABLE_LABEL_MAX_LENGTH}
                  placeholder={defaultLabel}
                  onChange={(event) => setField(pageTable.table, key, event.target.value)}
                />
              </div>
            );
          })}
        </SectionCard>
      ))}
    </div>
  );
}
