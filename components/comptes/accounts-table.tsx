import { ArrowDown, ArrowUp, ArrowUpDown, MapPin, Pencil, ScrollText } from "lucide-react";

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
};

export function AccountsTable({
  accounts,
  sort,
  onSortChange,
  onEdit,
}: AccountsTableProps) {
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
                <div>{account.name}</div>
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
