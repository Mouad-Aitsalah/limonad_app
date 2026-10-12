"use client";

import * as React from "react";
import { FileDown } from "lucide-react";

import { ExportDialog } from "@/components/import-export/export-dialog";
import { Button } from "@/components/ui/button";
import { browserFetchJson, runProductsExport, type ExportFormat } from "@/lib/import-export/export-runner";
import { PRODUCT_COLUMNS, type ProductColumnKey } from "@/lib/import-export/products-format";

const HINTS: Partial<Record<ProductColumnKey, string>> = {
  targetStock: "Stock de VOTRE dépôt. À l'import, il n'est appliqué qu'après confirmation explicite.",
  photo: "Les photos enregistrées dans l'application ne sont exportées qu'au format ZIP.",
  supplierCode: "Nécessaire pour créer les produits dans une autre organisation.",
};

/** Remarks shown under the export choices (photos vs format, creation columns, stock). */
export function productExportNotes(selected: ReadonlySet<ProductColumnKey>, format: ExportFormat): string[] {
  const notes: string[] = [];
  if (selected.has("photo") && format !== "zip") notes.push("Photos : seules les URL externes tiennent dans une cellule ; choisissez « ZIP + photos » pour transférer les photos enregistrées.");
  if (format === "zip" && !selected.has("photo")) notes.push("Format ZIP sans la colonne Photo : l'archive ne contiendra que le fichier de données.");
  const missing = PRODUCT_COLUMNS.filter((column) => column.requiredToCreate && !selected.has(column.key)).map((column) => column.header);
  if (missing.length) notes.push(`Sans ${missing.join(", ")}, ce fichier pourra mettre à jour des produits existants mais pas en créer dans une autre organisation.`);
  if (selected.has("targetStock")) notes.push("QuantiteStock : stock de votre dépôt. Un ancien export réimporté n'écrase le stock qu'après confirmation à l'import.");
  return notes;
}

/**
 * "Exporter" on /produits (admin only - the page renders it for the admin, and
 * the export API refuses every other role). Exports the products matching the
 * page's current filters (search, category, availability).
 */
export function ProductsExportButton({ filters }: { filters: { search: string; categoryId: string; status: string } }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="lg" className="w-full sm:w-auto" onClick={() => setOpen(true)} data-action="export-products">
        <FileDown aria-hidden="true" className="h-4 w-4" />
        Exporter
      </Button>
      <ExportDialog<ProductColumnKey, ExportFormat>
        open={open}
        onOpenChange={setOpen}
        title="Exporter les produits"
        description={
          filters.search || filters.categoryId !== "all" || filters.status !== "all"
            ? "Produits correspondant aux filtres actifs de la page. Le fichier est réimportable tel quel (même organisation ou une autre)."
            : "Tous les produits de l'organisation. Le fichier est réimportable tel quel (même organisation ou une autre)."
        }
        columns={PRODUCT_COLUMNS.map((column) => ({ key: column.key, label: column.label, header: column.header, locked: column.locked, hint: HINTS[column.key] }))}
        defaultSelected={PRODUCT_COLUMNS.filter((column) => column.defaultSelected).map((column) => column.key)}
        formats={[
          { value: "xlsx", label: "Excel (.xlsx)", hint: "Feuille « produits »" },
          { value: "csv", label: "CSV (.csv)", hint: "UTF-8, séparateur ;" },
          { value: "zip", label: "ZIP + photos", hint: "produits.xlsx + dossier photos/" },
        ]}
        defaultFormat="xlsx"
        notes={productExportNotes}
        run={(selected, format, onProgress) =>
          runProductsExport({
            columns: selected,
            format,
            filters: { search: filters.search, categoryId: filters.categoryId, status: filters.status },
            fetchJson: browserFetchJson,
            onProgress,
          })
        }
      />
    </>
  );
}
