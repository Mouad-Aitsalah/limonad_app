"use client";

import * as React from "react";
import { Plus } from "lucide-react";

import { EmployeeForm } from "@/components/employees/employee-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { EmployeeDto } from "@/types/employees";

type EmployeeDialogProps = {
  employee?: EmployeeDto | null;
  onSaved: () => Promise<void> | void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function EmployeeDialog({
  employee,
  onSaved,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: EmployeeDialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = controlledOnOpenChange ?? setUncontrolledOpen;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!employee ? (
        <DialogTrigger render={<Button type="button" size="lg" className="w-full sm:w-auto" />}>
          <Plus aria-hidden="true" className="h-4 w-4" />
          Ajouter employe
        </DialogTrigger>
      ) : null}

      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {employee ? "Modifier l'employe" : "Nouvel employe"}
          </DialogTitle>
          <DialogDescription>
            {employee
              ? "Mettez a jour la fiche employe et ses comptes comptables."
              : "Ajoutez un employe avec son code metier et saisissez directement ses comptes paie."}
          </DialogDescription>
        </DialogHeader>

        <EmployeeForm
          key={`${employee?.id ?? "new"}:${open ? "open" : "closed"}`}
          employee={employee}
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
