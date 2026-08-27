"use client";

import * as React from "react";
import { Plus } from "lucide-react";

import { AccountForm } from "@/components/comptes/account-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { AccountingAccountOptionDto } from "@/types/accounting";
import type { BusinessAccountListItem } from "@/types/business-account";

type AccountDialogProps = {
  account?: BusinessAccountListItem | null;
  accountingAccounts: AccountingAccountOptionDto[];
  onSaved: () => Promise<void> | void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function AccountDialog({
  account,
  accountingAccounts,
  onSaved,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: AccountDialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = controlledOnOpenChange ?? setUncontrolledOpen;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!account ? (
        <DialogTrigger
          render={<Button type="button" size="lg" className="w-full sm:w-auto" />}
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Nouveau compte
        </DialogTrigger>
      ) : null}

      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {account ? "Modifier le compte" : "Nouveau compte"}
          </DialogTitle>
          <DialogDescription>
            {account
              ? "Mettez a jour les informations du compte et l'emplacement GPS du client si disponible."
              : "Centralisez vos clients, fournisseurs, charges, tresoreries et comptes employes dans une seule liste."}
          </DialogDescription>
        </DialogHeader>

        <AccountForm
          account={account}
          accountingAccounts={accountingAccounts}
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
