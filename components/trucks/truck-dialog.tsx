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
import { TruckForm } from "@/components/trucks/truck-form";
import type { DepotDto, TruckDto, TruckMutationInput } from "@/types/operations-dto";

type TruckDialogProps = {
  truck?: TruckDto | null;
  mode?: "edit" | "view";
  depots: DepotDto[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSave: (
    values: TruckMutationInput,
    truckId?: string,
  ) => Promise<Record<string, string> | null>;
};

export function TruckDialog({
  truck = null,
  mode = "edit",
  depots,
  open: controlledOpen,
  onOpenChange,
  onSave,
}: TruckDialogProps) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const readOnly = Boolean(truck) && mode === "view";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!truck && (
        <DialogTrigger
          render={<Button type="button" size="lg" className="w-full sm:w-auto" />}
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Nouveau camion
        </DialogTrigger>
      )}

      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {readOnly ? "Consultation camion" : truck ? "Modifier le camion" : "Nouveau camion"}
          </DialogTitle>
          <DialogDescription>
            Donnees camions et emplacement de stock associees a PostgreSQL.
          </DialogDescription>
        </DialogHeader>

        <TruckForm
          truck={truck}
          depots={depots}
          readOnly={readOnly}
          onCancel={() => setOpen(false)}
          onSaved={async (values) => {
            const errors = await onSave(values, truck?.id);
            if (!errors) setOpen(false);
            return errors;
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
