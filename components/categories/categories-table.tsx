"use client";

import { Eye, Pencil, Power, Tags } from "lucide-react";

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
import type { CategoryListItem } from "@/types/category";

type CategoriesTableProps = {
  categories: CategoryListItem[];
  onView: (category: CategoryListItem) => void;
  onEdit: (category: CategoryListItem) => void;
  onToggleStatus: (category: CategoryListItem) => void;
};

export function CategoriesTable({
  categories,
  onView,
  onEdit,
  onToggleStatus,
}: CategoriesTableProps) {
  if (categories.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <Tags
          aria-hidden="true"
          className="h-10 w-10 text-muted-foreground/40"
        />
        <p className="text-sm text-muted-foreground">
          Aucune catégorie ne correspond à ces critères.
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Réf catégorie</TableHead>
          <TableHead>Désignation catégorie</TableHead>
          <TableHead className="text-right">Nombre de produits</TableHead>
          <TableHead>Statut</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {categories.map((category) => (
          <TableRow key={category.id}>
            <TableCell className="font-medium text-foreground">
              {category.code ?? "—"}
            </TableCell>
            <TableCell className="text-foreground">{category.name}</TableCell>
            <TableCell className="text-right tabular-nums">
              {category.productCount}
            </TableCell>
            <TableCell>
              <Badge
                variant="outline"
                className={
                  category.active
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 bg-slate-50 text-slate-600"
                }
              >
                {category.active ? "Actif" : "Inactif"}
              </Badge>
            </TableCell>
            <TableCell>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="Consulter la catégorie"
                  onClick={() => onView(category)}
                >
                  <Eye aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="Modifier la catégorie"
                  onClick={() => onEdit(category)}
                >
                  <Pencil aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant={category.active ? "destructive" : "outline"}
                  size="icon-sm"
                  aria-label={category.active ? "Désactiver la catégorie" : "Activer la catégorie"}
                  onClick={() => onToggleStatus(category)}
                >
                  <Power aria-hidden="true" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
