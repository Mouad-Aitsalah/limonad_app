"use client";

import type { BatchRowResult, ImportReportView } from "@/lib/products-import-batches";
import { formatImportCount } from "@/lib/products-import-shared";

/** The problem list is capped: 1 000 conflicts must not become 1 000 list items. */
const MAX_LISTED_PROBLEMS = 100;

type ProductsImportReportProps = {
  report: ImportReportView;
  problemRows: BatchRowResult[];
};

/**
 * The final report. "Import terminé" is only ever shown for a clean run: any
 * failed batch, line in error or conflict, or interruption says so and lists the
 * batches / lines concerned.
 */
export function ProductsImportReport({ report, problemRows }: ProductsImportReportProps) {
  const listed = problemRows.slice(0, MAX_LISTED_PROBLEMS);
  return (
    <div
      className={`space-y-2 rounded-xl border p-4 text-sm ${
        report.withProblems || report.title === "Import interrompu" ? "border-amber-400/70 bg-amber-50/60" : "bg-muted/20"
      }`}
    >
      <p className="text-base font-medium">{report.title}</p>
      <ul className="grid gap-x-6 gap-y-1 tabular-nums sm:grid-cols-2">
        <li>Nouveaux : {formatImportCount(report.created)}</li>
        <li>Mis à jour : {formatImportCount(report.updated)}</li>
        <li>Inchangés : {formatImportCount(report.unchanged)}</li>
        <li>Conflits : {formatImportCount(report.conflicts)}</li>
        <li>Erreurs : {formatImportCount(report.errors)}</li>
        {report.notProcessedRows > 0 ? (
          <li className="text-destructive">Lignes non traitées : {formatImportCount(report.notProcessedRows)}</li>
        ) : null}
      </ul>
      <p className="text-muted-foreground">
        Fournisseurs créés : {formatImportCount(report.suppliersCreated)} · Catégories créées :{" "}
        {formatImportCount(report.categoriesCreated)} · Stock — mouvements créés :{" "}
        {formatImportCount(report.stockMovementsCreated)}
      </p>

      {report.failures.length > 0 ? (
        <div className="space-y-1">
          <p className="font-medium text-destructive">Lots en échec</p>
          <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
            {report.failures.map((failure) => (
              <li key={failure.batch}>
                Lot {failure.batch} — lignes Excel {formatImportCount(failure.firstRow)} à {formatImportCount(failure.lastRow)} (
                {formatImportCount(failure.rowCount)} lignes) — {failure.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {report.notProcessedRows > 0 ? (
        <p className="text-muted-foreground">
          Relancez le même fichier : les lignes déjà importées seront reconnues comme inchangées, seules les lignes restantes
          seront traitées.
        </p>
      ) : null}

      {listed.length > 0 ? (
        <div className="space-y-1">
          <p className="font-medium">Lignes refusées à l&apos;import</p>
          <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
            {listed.map((row) => (
              <li key={row.excelRow}>
                Ligne {row.excelRow} — {row.reference} — {row.message}
              </li>
            ))}
            {problemRows.length > listed.length ? (
              <li className="list-none">… et {formatImportCount(problemRows.length - listed.length)} autre(s)</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
