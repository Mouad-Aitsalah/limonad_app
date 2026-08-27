import { ArrowDown, ArrowUp, ArrowUpDown, Pencil, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ContactDto } from "@/types/contacts";

export type ContactsSortKey = "reference" | "fullName" | "status" | "createdAt";

export type ContactsSortState = {
  key: ContactsSortKey;
  direction: "asc" | "desc";
};

const sortableColumns: Array<{ key: ContactsSortKey; label: string }> = [
  { key: "reference", label: "Reference" },
  { key: "fullName", label: "Nom complet" },
];

type ContactsTableProps = {
  contacts: ContactDto[];
  sort: ContactsSortState;
  onSortChange: (key: ContactsSortKey) => void;
  onEdit: (contact: ContactDto) => void;
};

export function ContactsTable({ contacts, sort, onSortChange, onEdit }: ContactsTableProps) {
  if (contacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <Users aria-hidden="true" className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Aucun contact ne correspond a ces criteres.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            {sortableColumns.map((column) => (
              <TableHead key={column.key}>
                <SortButton
                  label={column.label}
                  active={sort.key === column.key}
                  direction={sort.direction}
                  onClick={() => onSortChange(column.key)}
                />
              </TableHead>
            ))}
            <TableHead>Reference fournisseur</TableHead>
            <TableHead>Telephone 1</TableHead>
            <TableHead>Telephone 2</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>
              <SortButton
                label="Statut"
                active={sort.key === "status"}
                direction={sort.direction}
                onClick={() => onSortChange("status")}
              />
            </TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contacts.map((contact) => (
            <TableRow key={contact.id}>
              <TableCell className="font-medium text-foreground">{contact.reference}</TableCell>
              <TableCell className="font-medium text-foreground">{contact.fullName}</TableCell>
              <TableCell className="text-muted-foreground">
                {contact.supplierCode ? `${contact.supplierCode} - ${contact.supplierName}` : "-"}
              </TableCell>
              <TableCell>{contact.phone1 ?? "-"}</TableCell>
              <TableCell>{contact.phone2 ?? "-"}</TableCell>
              <TableCell className="text-muted-foreground">{contact.email ?? "-"}</TableCell>
              <TableCell>
                <Badge variant={contact.status === "ACTIVE" ? "secondary" : "outline"}>
                  {contact.status === "ACTIVE" ? "Actif" : "Inactif"}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="Modifier le contact"
                  onClick={() => onEdit(contact)}
                >
                  <Pencil aria-hidden="true" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SortButton({
  label,
  active,
  direction,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: ContactsSortState["direction"];
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-left">
      <span>{label}</span>
      {!active ? (
        <ArrowUpDown aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
      ) : direction === "asc" ? (
        <ArrowUp aria-hidden="true" className="h-3.5 w-3.5 text-foreground" />
      ) : (
        <ArrowDown aria-hidden="true" className="h-3.5 w-3.5 text-foreground" />
      )}
    </button>
  );
}
