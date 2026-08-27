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
import { UserForm } from "@/components/users/user-form";

export function UserDialog() {
  const [open, setOpen] = React.useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button type="button" size="lg" className="w-full sm:w-auto" />}
      >
        <Plus aria-hidden="true" className="h-4 w-4" />
        Nouvel utilisateur
      </DialogTrigger>

      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">Nouvel utilisateur</DialogTitle>
          <DialogDescription>
            Renseignez les informations du compte. Aucune donnée n&apos;est
            enregistrée pour le moment (simulation).
          </DialogDescription>
        </DialogHeader>

        <UserForm
          key={open ? "open" : "closed"}
          onCancel={() => setOpen(false)}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
