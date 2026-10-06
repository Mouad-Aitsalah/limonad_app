"use client";

import { Button } from "@/components/ui/button";
import { progressPercent, type ImportProgress } from "@/lib/products-import-batches";
import { formatImportCount } from "@/lib/products-import-shared";

type ProductsImportProgressProps = {
  progress: ImportProgress;
  stopping: boolean;
  onStop: () => void;
};

/**
 * "Import des produits" while the batches are being sent. The bar counts the
 * lines that are really being imported (NEW + UPDATE), not the whole file:
 * 0 / 8 000, 200 / 8 000, ... 8 000 / 8 000.
 */
export function ProductsImportProgress({ progress, stopping, onStop }: ProductsImportProgressProps) {
  const percent = progressPercent(progress);
  const done = progress.processed + progress.failedRows;
  return (
    <div className="space-y-3 rounded-xl border bg-muted/20 p-4 text-sm" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">Import des produits</p>
        <Button type="button" variant="outline" size="sm" disabled={stopping} onClick={onStop}>
          {stopping ? "Arrêt après le lot en cours..." : "Arrêter l'import"}
        </Button>
      </div>
      <div
        role="progressbar"
        aria-label="Progression de l'import"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={done}
        className="h-3 w-full overflow-hidden rounded-full bg-border"
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${percent}%` }} />
      </div>
      <p className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium tabular-nums">
          {formatImportCount(done)} / {formatImportCount(progress.total)}
        </span>
        <span className="tabular-nums text-muted-foreground">{percent} %</span>
      </p>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground tabular-nums">
        <span>Traités : {formatImportCount(progress.processed)}</span>
        <span>Nouveaux : {formatImportCount(progress.created)}</span>
        <span>Mis à jour : {formatImportCount(progress.updated)}</span>
        {progress.unchanged > 0 ? <span>Inchangés : {formatImportCount(progress.unchanged)}</span> : null}
        {progress.conflicts > 0 ? <span>Conflits : {formatImportCount(progress.conflicts)}</span> : null}
        <span>Erreurs : {formatImportCount(progress.errors)}</span>
        {progress.failedRows > 0 ? (
          <span className="text-destructive">Lignes en échec : {formatImportCount(progress.failedRows)}</span>
        ) : null}
        <span>
          Lot {formatImportCount(Math.min(progress.batchesDone + 1, progress.batchesTotal))} /{" "}
          {formatImportCount(progress.batchesTotal)}
        </span>
      </p>
    </div>
  );
}
