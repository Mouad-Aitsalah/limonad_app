"use client";

import * as React from "react";
import { Plus } from "lucide-react";

import { ContactForm } from "@/components/contacts/contact-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { ContactDto } from "@/types/contacts";
import type { SupplierPartnerDto } from "@/types/operations-dto";

type ContactDialogProps = {
  contact?: ContactDto | null;
  suppliers: SupplierPartnerDto[];
  onSaved: () => Promise<void> | void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function ContactDialog({
  contact,
  suppliers,
  onSaved,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: ContactDialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = controlledOnOpenChange ?? setUncontrolledOpen;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!contact ? (
        <DialogTrigger render={<Button type="button" size="lg" className="w-full sm:w-auto" />}>
          <Plus aria-hidden="true" className="h-4 w-4" />
          Nouveau contact
        </DialogTrigger>
      ) : null}

      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {contact ? "Modifier le contact" : "Nouveau contact"}
          </DialogTitle>
          <DialogDescription>
            {contact
              ? "Mettez a jour les informations de ce contact."
              : "Ajoutez un contact general, independant des clients et fournisseurs."}
          </DialogDescription>
        </DialogHeader>

        <ContactForm
          contact={contact}
          suppliers={suppliers}
          onCancel={() => setOpen(false)}
          onSaved={async () => {
            await onSaved();
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
