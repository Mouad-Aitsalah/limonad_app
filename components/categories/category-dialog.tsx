"use client";

import * as React from "react";
import { Plus } from "lucide-react";

import { CategoryForm } from "@/components/categories/category-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { CategoryListItem, CategoryMutationInput } from "@/types/category";

type CategoryDialogProps = {
  category?: CategoryListItem | null;
  mode?: "edit" | "view";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSave: (
    values: CategoryMutationInput,
    categoryId?: string,
  ) => Promise<Record<string, string> | null>;
};

export function CategoryDialog({
  category = null,
  mode = "edit",
  open: controlledOpen,
  onOpenChange,
  onSave,
}: CategoryDialogProps) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const isEditing = Boolean(category) && mode === "edit";
  const isViewing = Boolean(category) && mode === "view";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!category ? (
        <DialogTrigger
          render={<Button type="button" size="lg" className="w-full sm:w-auto" />}
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Nouvelle catégorie
        </DialogTrigger>
      ) : null}

      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {isViewing
              ? "Consultation catégorie"
              : isEditing
                ? "Modifier la catégorie"
                : "Nouvelle catégorie"}
          </DialogTitle>
          <DialogDescription>
            {isViewing
              ? "Consultez la référence, la désignation et le statut de la catégorie."
              : "Renseignez la référence, la désignation et le statut de la catégorie."}
          </DialogDescription>
        </DialogHeader>

        <CategoryForm
          category={category}
          readOnly={isViewing}
          onCancel={() => setOpen(false)}
          onSaved={async (values) => {
            const errors = await onSave(values, category?.id);
            if (!errors) {
              setOpen(false);
            }
            return errors;
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
