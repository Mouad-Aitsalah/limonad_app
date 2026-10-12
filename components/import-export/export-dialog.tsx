"use client";

import * as React from "react";
import { CheckCircle2, Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { downloadFile, type ExportProgress, type ExportResult } from "@/lib/import-export/export-runner";
import { cn } from "@/lib/utils";

export type ExportColumnOption<K extends string> = { key: K; label: string; header: string; locked?: boolean; hint?: string };
export type ExportFormatOption<F extends string> = { value: F; label: string; hint: string };

export type ExportState =
  | { kind: "idle" }
  | { kind: "running"; progress: ExportProgress | null }
  | { kind: "done"; result: ExportResult }
  | { kind: "error"; message: string };

const PHASE_LABEL: Record<ExportProgress["phase"], string> = {
  data: "Lecture des données",
  photos: "Récupération des photos",
  file: "Création du fichier",
};

/**
 * The export window shared by /produits and /comptes: column choice (the
 * identifier columns are always included), format, optional extra settings,
 * then a run with its progress, its error, and the download. The file is built
 * in the browser (lib/import-export/export-runner.ts) and saved with the
 * browser's own download.
 */
export function ExportDialog<K extends string, F extends string>({
  open,
  onOpenChange,
  title,
  description,
  columns,
  defaultSelected,
  formats,
  defaultFormat,
  extra,
  notes,
  run,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  columns: ReadonlyArray<ExportColumnOption<K>>;
  defaultSelected: ReadonlyArray<K>;
  formats: ReadonlyArray<ExportFormatOption<F>>;
  defaultFormat: F;
  /** Settings shown under the columns (type filter, GPS, ...). */
  extra?: React.ReactNode;
  /** Remarks computed from the current choice (e.g. "photos need the ZIP format"). */
  notes?: (selected: ReadonlySet<K>, format: F) => string[];
  run: (selected: ReadonlySet<K>, format: F, onProgress: (progress: ExportProgress) => void) => Promise<ExportResult>;
}) {
  const [selected, setSelected] = React.useState<Set<K>>(() => new Set(defaultSelected));
  const [format, setFormat] = React.useState<F>(defaultFormat);
  const [state, setState] = React.useState<ExportState>({ kind: "idle" });
  const running = state.kind === "running";

  // Every opening starts from the defaults (QuantiteStock / photo never stay ticked from a previous export).
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSelected(new Set(defaultSelected));
      setFormat(defaultFormat);
      setState({ kind: "idle" });
    }
  }

  function toggle(key: K) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function start() {
    setState({ kind: "running", progress: null });
    try {
      const result = await run(selected, format, (progress) => setState({ kind: "running", progress }));
      downloadFile(result);
      setState({ kind: "done", result });
    } catch (error) {
      setState({ kind: "error", message: error instanceof Error ? error.message : "Exportation impossible." });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (running) return; // never close in the middle of a run
        if (!next) setState({ kind: "idle" });
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[88vh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <ExportPanel
          columns={columns}
          selected={selected}
          onToggle={toggle}
          formats={formats}
          format={format}
          onFormatChange={setFormat}
          extra={extra}
          notes={notes?.(selected, format) ?? []}
          state={state}
        />

        <DialogFooter>
          <Button type="button" variant="outline" disabled={running} onClick={() => onOpenChange(false)}>
            Fermer
          </Button>
          <Button type="button" disabled={running} onClick={() => void start()} data-export="start">
            {running ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Download aria-hidden="true" className="size-4" />}
            Exporter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The body of the export window, stateless (rendered as is by the tests). */
export function ExportPanel<K extends string, F extends string>({
  columns,
  selected,
  onToggle,
  formats,
  format,
  onFormatChange,
  extra,
  notes,
  state,
}: {
  columns: ReadonlyArray<ExportColumnOption<K>>;
  selected: ReadonlySet<K>;
  onToggle: (key: K) => void;
  formats: ReadonlyArray<ExportFormatOption<F>>;
  format: F;
  onFormatChange: (format: F) => void;
  extra?: React.ReactNode;
  notes: string[];
  state: ExportState;
}) {
  const running = state.kind === "running";
  return (
    <>
      <fieldset className="space-y-2" disabled={running} data-export="columns">
        <legend className="text-sm font-semibold">Colonnes</legend>
        <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
          {columns.map((column) => (
            <label key={column.key} className={cn("flex items-start gap-2 text-sm", column.locked && "text-muted-foreground")}>
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-emerald-600"
                checked={column.locked || selected.has(column.key)}
                disabled={column.locked}
                onChange={() => onToggle(column.key)}
                data-column={column.key}
              />
              <span>
                {column.label} <code className="text-[0.7rem] text-muted-foreground">{column.header}</code>
                {column.locked ? <span className="ml-1 text-[0.7rem]">(toujours incluse)</span> : null}
                {column.hint ? <span className="block text-[0.7rem] text-muted-foreground">{column.hint}</span> : null}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {extra ? <div className={cn(running && "pointer-events-none opacity-60")}>{extra}</div> : null}

      <fieldset className="space-y-2" disabled={running} data-export="format">
        <legend className="text-sm font-semibold">Format</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {formats.map((option) => (
            <label
              key={option.value}
              className={cn(
                "cursor-pointer rounded-xl border px-3 py-2 text-sm",
                format === option.value ? "border-emerald-500 bg-emerald-50" : "border-border hover:bg-muted/40",
              )}
            >
              <input
                type="radio"
                name="export-format"
                className="sr-only"
                checked={format === option.value}
                onChange={() => onFormatChange(option.value)}
                data-format={option.value}
              />
              <span className="font-semibold">{option.label}</span>
              <span className="block text-[0.72rem] text-muted-foreground">{option.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {notes.length ? (
        <ul role="note" className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}

      {state.kind === "running" ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          {state.progress
            ? `${PHASE_LABEL[state.progress.phase]} : ${state.progress.done}${state.progress.total !== null ? ` / ${state.progress.total}` : ""}`
            : "Préparation…"}
        </p>
      ) : null}
      {state.kind === "error" ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.message}
        </p>
      ) : null}
      {state.kind === "done" ? (
        <div role="status" className="space-y-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900" data-export="done">
          <p className="flex items-center gap-2 font-semibold">
            <CheckCircle2 aria-hidden="true" className="size-4" />
            {state.result.rowCount} ligne(s) exportée(s) : {state.result.fileName}
          </p>
          {state.result.warnings.map((warning) => (
            <p key={warning} className="text-xs">
              {warning}
            </p>
          ))}
        </div>
      ) : null}
    </>
  );
}
