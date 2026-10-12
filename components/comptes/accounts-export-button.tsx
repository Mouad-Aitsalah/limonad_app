"use client";

import * as React from "react";
import { FileDown } from "lucide-react";

import { ExportDialog } from "@/components/import-export/export-dialog";
import { Button } from "@/components/ui/button";
import {
  ACCOUNT_COLUMNS,
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABELS,
  type AccountColumnKey,
  type AccountTypeCode,
} from "@/lib/import-export/accounts-format";
import { browserFetchJson, runAccountsExport } from "@/lib/import-export/export-runner";

const TYPE_PLURALS: Record<AccountTypeCode, string> = {
  CUSTOMER: "Clients",
  SUPPLIER: "Fournisseurs",
  EXPENSE: "Charges",
  TREASURY: "Trésorerie",
  EMPLOYEE: "Employés",
};

/**
 * "Exporter" on /comptes (admin only - rendered for the admin, and the export
 * API refuses every other role): type filter (pre-set to the page's type
 * filter), column choice, GPS as two separate Latitude / Longitude columns.
 */
export function AccountsExportButton({ currentType }: { currentType: string }) {
  const [open, setOpen] = React.useState(false);
  const initialTypes = (ACCOUNT_TYPES as readonly string[]).includes(currentType) ? [currentType as AccountTypeCode] : [...ACCOUNT_TYPES];
  const [types, setTypes] = React.useState<Set<AccountTypeCode>>(() => new Set(initialTypes));
  const [includeGps, setIncludeGps] = React.useState(true);

  const exportable = ACCOUNT_COLUMNS.filter((column) => !column.gps);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="w-full sm:w-auto"
        onClick={() => {
          setTypes(new Set(initialTypes));
          setIncludeGps(true);
          setOpen(true);
        }}
        data-action="export-accounts"
      >
        <FileDown aria-hidden="true" className="h-4 w-4" />
        Exporter
      </Button>
      <ExportDialog<AccountColumnKey, "xlsx" | "csv">
        open={open}
        onOpenChange={setOpen}
        title="Exporter les comptes"
        description="Feuille « Comptes », réimportable telle quelle dans cette organisation ou une autre (rapprochement par code et type, jamais par identifiant interne). Les soldes ne sont pas exportés."
        columns={exportable.map((column) => ({
          key: column.key,
          label: column.label,
          header: column.header,
          locked: column.locked,
          hint: column.types.length ? `Pour : ${column.types.map((type) => ACCOUNT_TYPE_LABELS[type]).join(", ")}` : undefined,
        }))}
        defaultSelected={exportable.map((column) => column.key)}
        formats={[
          { value: "xlsx", label: "Excel (.xlsx)", hint: "Feuille « Comptes »" },
          { value: "csv", label: "CSV (.csv)", hint: "UTF-8, séparateur ;" },
        ]}
        defaultFormat="xlsx"
        extra={
          <AccountsExportOptions
            types={types}
            onToggleType={(type) =>
              setTypes((current) => {
                const next = new Set(current);
                if (next.has(type)) next.delete(type);
                else next.add(type);
                return next;
              })
            }
            includeGps={includeGps}
            onToggleGps={() => setIncludeGps((value) => !value)}
          />
        }
        notes={() => {
          const notes: string[] = [];
          if (types.size === 0) notes.push("Choisissez au moins un type de compte.");
          if (types.has("EMPLOYEE")) notes.push("Employés : une ligne par employé (code, comptes avance et salaire) ; leur import est réservé à l'administrateur.");
          return notes;
        }}
        run={async (selected, format, onProgress) => {
          if (types.size === 0) throw new Error("Choisissez au moins un type de compte.");
          return runAccountsExport({
            types: ACCOUNT_TYPES.filter((type) => types.has(type)),
            columns: selected,
            includeGps,
            format,
            fetchJson: browserFetchJson,
            onProgress,
          });
        }}
      />
    </>
  );
}

/** Type filter + GPS switch of the accounts export (stateless). */
export function AccountsExportOptions({
  types,
  onToggleType,
  includeGps,
  onToggleGps,
}: {
  types: ReadonlySet<AccountTypeCode>;
  onToggleType: (type: AccountTypeCode) => void;
  includeGps: boolean;
  onToggleGps: () => void;
}) {
  return (
    <div className="space-y-3">
      <fieldset className="space-y-2" data-export="types">
        <legend className="text-sm font-semibold">Types de comptes</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {ACCOUNT_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-emerald-600" checked={types.has(type)} data-type={type} onChange={() => onToggleType(type)} />
              {TYPE_PLURALS[type]}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 size-4 accent-emerald-600" checked={includeGps} onChange={onToggleGps} data-export="gps" />
        <span>
          Coordonnées GPS des clients (colonnes <code>Latitude</code> et <code>Longitude</code>, 7 décimales)
        </span>
      </label>
    </div>
  );
}
