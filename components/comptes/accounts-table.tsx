import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ImagePlus, MapPin, Pencil, ScrollText, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import { readFileAsDataUrl, validateLogoFile } from "@/lib/logo-validation";
import { useAuth } from "@/hooks/use-auth";
import type { BusinessAccountListItem } from "@/types/business-account";
import { useColumnLabels } from "@/components/table-labels/table-labels-provider";
import { useTableColumns } from "@/components/table-columns/table-columns-provider";
import type { TableColumnKey } from "@/lib/table-labels/registry";

type AccountColumn = TableColumnKey<"accounts">;

const typeLabels: Record<BusinessAccountListItem["type"], string> = {
  CUSTOMER: "Client",
  SUPPLIER: "Fournisseur",
  EXPENSE: "Charge",
  TREASURY: "Tresorerie",
  EMPLOYEE: "Employe",
};

export type AccountsSortKey =
  | "accountNumber"
  | "name"
  | "type"
  | "creditLimit"
  | "createdAt";

export type AccountsSortState = {
  key: AccountsSortKey;
  direction: "asc" | "desc";
};

// Columns whose header sorts the current page (unchanged), and their alignment.
const SORTABLE_COLUMNS: Partial<Record<AccountColumn, { key: AccountsSortKey; align?: "right" }>> = {
  accountNumber: { key: "accountNumber" },
  name: { key: "name" },
  type: { key: "type" },
  creditLimit: { key: "creditLimit", align: "right" },
  createdAt: { key: "createdAt" },
};

type AccountsTableProps = {
  accounts: BusinessAccountListItem[];
  sort: AccountsSortState;
  onSortChange: (key: AccountsSortKey) => void;
  onEdit: (account: BusinessAccountListItem) => void;
  onLogoChanged: () => Promise<void> | void;
};

export function AccountsTable({
  accounts,
  sort,
  onSortChange,
  onEdit,
  onLogoChanged,
}: AccountsTableProps) {
  const { currentUser } = useAuth();
  const label = useColumnLabels("accounts");
  // Columns in the order chosen by the admin ("Personnaliser les colonnes"); default = the original ones.
  // Hiding a column never changes the search, the filters, the sort or the export.
  const { columns } = useTableColumns("accounts", "accounts");
  const canManageSupplierLogo = currentUser?.role === "admin";
  if (accounts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <ScrollText
          aria-hidden="true"
          className="h-10 w-10 text-muted-foreground/40"
        />
        <p className="text-sm text-muted-foreground">
          Aucun compte ne correspond a ces criteres.
        </p>
      </div>
    );
  }

  function headCell(column: AccountColumn) {
    const sortable = SORTABLE_COLUMNS[column];
    if (!sortable) {
      return (
        <TableHead key={column} className={column === "actions" ? "text-right" : undefined}>
          {label(column)}
        </TableHead>
      );
    }
    return (
      <TableHead key={column} className={sortable.align === "right" ? "text-right" : undefined}>
        <button
          type="button"
          onClick={() => onSortChange(sortable.key)}
          className={
            sortable.align === "right"
              ? "inline-flex w-full items-center justify-end gap-1 text-left"
              : "inline-flex items-center gap-1 text-left"
          }
        >
          <span>{label(column)}</span>
          <SortIcon active={sort.key === sortable.key} direction={sort.direction} />
        </button>
      </TableHead>
    );
  }

  function cell(column: AccountColumn, account: BusinessAccountListItem) {
    switch (column) {
      case "accountNumber":
        return (
          <TableCell key={column} className="font-medium text-foreground">
            {account.accountNumber}
          </TableCell>
        );
      case "name": {
        const hasGps =
          account.latitude !== null &&
          account.latitude !== undefined &&
          account.longitude !== null &&
          account.longitude !== undefined;
        return (
          <TableCell key={column} className="font-medium text-foreground">
            <div className="flex items-center gap-3">
              {account.type === "SUPPLIER" ? (
                <SupplierLogo account={account} canManage={canManageSupplierLogo} onChanged={onLogoChanged} />
              ) : null}
              <div>{account.name}</div>
            </div>
            {account.type === "CUSTOMER" ? (
              <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className={hasGps ? "h-3.5 w-3.5 text-amber-500" : "h-3.5 w-3.5"} />
                <span>
                  {hasGps
                    ? `${account.latitude!.toFixed(5)}, ${account.longitude!.toFixed(5)}`
                    : "Emplacement GPS non defini"}
                </span>
              </div>
            ) : null}
          </TableCell>
        );
      }
      case "type":
        return <TableCell key={column}>{typeLabels[account.type]}</TableCell>;
      case "phone":
        return <TableCell key={column}>{account.phone ?? "-"}</TableCell>;
      case "creditLimit":
        return (
          <TableCell key={column} className="text-right">
            {account.creditLimit === null ? "-" : formatCurrency(account.creditLimit)}
          </TableCell>
        );
      case "createdAt":
        return <TableCell key={column}>{formatBusinessAccountDate(account.createdAt)}</TableCell>;
      case "createdBy":
        return (
          <TableCell key={column} className="text-muted-foreground">
            {account.createdByName ?? "-"}
          </TableCell>
        );
      case "actions":
        return (
          <TableCell key={column}>
            <div className="flex justify-end">
              {account.type === "CUSTOMER" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="Modifier le compte"
                  onClick={() => onEdit(account)}
                >
                  <Pencil aria-hidden="true" />
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">-</span>
              )}
            </div>
          </TableCell>
        );
      default:
        return null;
    }
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>{columns.map((column) => headCell(column))}</TableRow>
      </TableHeader>
      <TableBody>
        {accounts.map((account) => (
          <TableRow key={account.id}>{columns.map((column) => cell(column, account))}</TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function SortIcon({
  active,
  direction,
}: {
  active: boolean;
  direction: AccountsSortState["direction"];
}) {
  if (!active) {
    return <ArrowUpDown aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />;
  }

  if (direction === "asc") {
    return <ArrowUp aria-hidden="true" className="h-3.5 w-3.5 text-foreground" />;
  }

  return <ArrowDown aria-hidden="true" className="h-3.5 w-3.5 text-foreground" />;
}

function formatBusinessAccountDate(value: string) {
  return new Date(value).toLocaleDateString("fr-FR");
}

function SupplierLogo({
  account,
  canManage,
  onChanged,
}: {
  account: BusinessAccountListItem;
  canManage: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [saving, setSaving] = React.useState(false);
  const [pendingPreview, setPendingPreview] = React.useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    const validation = validateLogoFile(file);
    if (!validation.ok) {
      toast.error(validation.message);
      return;
    }

    try {
      const logoDataUrl = await readFileAsDataUrl(file);
      setPendingPreview(logoDataUrl);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible de lire le logo.");
    }
  }

  async function savePreview() {
    if (!pendingPreview) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/suppliers/${account.sourceId}/logo`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logoDataUrl: pendingPreview }),
      });
      const body = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(body.message ?? "Impossible d'enregistrer le logo.");
      toast.success("Logo fournisseur enregistré.");
      setPendingPreview(null);
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible d'enregistrer le logo.");
    } finally {
      setSaving(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function clearLogo() {
    setSaving(true);
    try {
      const response = await fetch(`/api/suppliers/${account.sourceId}/logo`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logoDataUrl: null }),
      });
      const body = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(body.message ?? "Impossible de supprimer le logo.");
      toast.success("Logo fournisseur supprimé.");
      setPendingPreview(null);
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible de supprimer le logo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      {pendingPreview || account.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={pendingPreview ?? account.logoUrl ?? ""}
          alt={pendingPreview ? `Aperçu du logo de ${account.name}` : `Logo de ${account.name}`}
          className="size-10 rounded-xl border border-border bg-muted/40 object-contain p-1"
        />
      ) : (
        <div className="flex size-10 items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 text-xs text-muted-foreground">
          —
        </div>
      )}
      {canManage && pendingPreview ? (
        <div className="flex items-center gap-1">
          <Button type="button" size="sm" disabled={saving} onClick={() => void savePreview()}>
            Enregistrer
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={saving}
            aria-label="Annuler l'aperçu du logo"
            onClick={() => setPendingPreview(null)}
          >
            <span aria-hidden="true">×</span>
          </Button>
        </div>
      ) : canManage ? (
        <div className="flex items-center gap-1">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={saving}
            aria-label={account.logoUrl ? "Modifier le logo du fournisseur" : "Ajouter le logo du fournisseur"}
            onClick={() => inputRef.current?.click()}
          >
            <ImagePlus aria-hidden="true" />
          </Button>
          {account.logoUrl ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={saving}
              aria-label="Supprimer le logo du fournisseur"
              onClick={() => void clearLogo()}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
