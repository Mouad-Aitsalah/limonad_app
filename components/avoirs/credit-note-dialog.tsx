"use client";

import * as React from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CreditNoteForm } from "@/components/avoirs/credit-note-form";
import type { CreateCreditNoteInput, CreditNote } from "@/types/credit-note";
import type { CustomerDto } from "@/types/operations-dto";

type CreditNoteDialogProps = {
  customers: CustomerDto[];
  onSaved: (input: CreateCreditNoteInput, status: CreditNote["status"]) => Promise<void>;
};

export function CreditNoteDialog({
  customers,
  onSaved,
}: CreditNoteDialogProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button type="button" size="lg" className="w-full sm:w-auto" />}
      >
        <Plus aria-hidden="true" className="h-4 w-4" />
        Nouvel avoir
      </DialogTrigger>

      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle className="text-xl">Nouvel avoir</DialogTitle>
          <DialogDescription>
            Selectionnez un client, choisissez les produits deja achetes, puis
            validez le retour en stock.
          </DialogDescription>
        </DialogHeader>

        <CreditNoteForm
          key={open ? "open" : "closed"}
          customers={customers}
          onCancel={() => setOpen(false)}
          onSaved={async (input, status) => {
            await onSaved(input, status);
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
