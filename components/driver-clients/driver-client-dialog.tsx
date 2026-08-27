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
import { DriverClientForm } from "@/components/driver-clients/driver-client-form";
import type { Customer } from "@/types/customer";

type DriverClientDialogProps = {
  customers: Customer[];
  driverId: string;
  driverName: string;
  truckId: string | null;
  tourId: string | null;
  customer?: Customer | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSaved: (customer: Customer) => void;
};

export function DriverClientDialog({
  customers,
  driverId,
  driverName,
  truckId,
  tourId,
  customer = null,
  open: controlledOpen,
  onOpenChange,
  onSaved,
}: DriverClientDialogProps) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = controlledOpen ?? internalOpen;

  function setOpen(value: boolean) {
    onOpenChange?.(value);
    setInternalOpen(value);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!customer && (
        <DialogTrigger
          render={<Button type="button" size="lg" className="w-full sm:w-auto" />}
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Nouveau client
        </DialogTrigger>
      )}

      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {customer ? "Modifier le client" : "Nouveau client"}
          </DialogTitle>
          <DialogDescription>
            Les clients crees depuis cet espace sont rattaches a votre compte
            chauffeur et disponibles dans le POS chauffeur.
          </DialogDescription>
        </DialogHeader>

        <DriverClientForm
          key={open ? customer?.id ?? "new" : "closed"}
          customers={customers}
          driverId={driverId}
          driverName={driverName}
          truckId={truckId}
          tourId={tourId}
          customer={customer}
          onCancel={() => setOpen(false)}
          onSaved={(savedCustomer) => {
            onSaved(savedCustomer);
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
