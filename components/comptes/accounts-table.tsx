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

const sortableColumns: Array<{
  key: AccountsSortKey;
  label: string;
  align?: "left" | "right";
}> = [
  { key: "accountNumber", label: "N° compte" },
  { key: "name", label: "Nom du compte" },
  { key: "type", label: "Type de compte" },
];

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

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {sortableColumns.map((column) => (
            <TableHead
              key={column.key}
              className={column.align === "right" ? "text-right" : undefined}
            >
              <button
                type="button"
                onClick={() => onSortChange(column.key)}
                className={
                  column.align === "right"
                    ? "inline-flex w-full items-center justify-end gap-1 text-left"
                    : "inline-flex items-center gap-1 text-left"
                }
              >
                <span>{column.label}</span>
                <SortIcon active={sort.key === column.key} direction={sort.direction} />
              </button>
            </TableHead>
          ))}
          <TableHead>Telephone</TableHead>
          <TableHead className="text-right">
            <button
              type="button"
              onClick={() => onSortChange("creditLimit")}
              className="inline-flex w-full items-center justify-end gap-1 text-left"
            >
              <span>Plafond</span>
              <SortIcon active={sort.key === "creditLimit"} direction={sort.direction} />
            </button>
          </TableHead>
          <TableHead>
            <button
              type="button"
              onClick={() => onSortChange("createdAt")}
              className="inline-flex items-center gap-1 text-left"
            >
              <span>Date de creation</span>
              <SortIcon active={sort.key === "createdAt"} direction={sort.direction} />
            </button>
          </TableHead>
          <TableHead>Cree par</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {accounts.map((account) => {
          const hasGps =
            account.latitude !== null &&
            account.latitude !== undefined &&
            account.longitude !== null &&
            account.longitude !== undefined;
          const canEdit = account.type === "CUSTOMER";

          return (
            <TableRow key={account.id}>
              <TableCell className="font-medium text-foreground">
                {account.accountNumber}
              </TableCell>
              <TableCell className="font-medium text-foreground">
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
              <TableCell>{typeLabels[account.type]}</TableCell>
              <TableCell>{account.phone ?? "-"}</TableCell>
              <TableCell className="text-right">
                {account.creditLimit === null ? "-" : formatCurrency(account.creditLimit)}
              </TableCell>
              <TableCell>{formatBusinessAccountDate(account.createdAt)}</TableCell>
              <TableCell className="text-muted-foreground">
                {account.createdByName ?? "-"}
              </TableCell>
              <TableCell>
                <div className="flex justify-end">
                  {canEdit ? (
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
            </TableRow>
          );
        })}
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
