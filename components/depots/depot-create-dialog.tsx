"use client";

import * as React from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DepotCreateInput } from "@/types/operations-dto";

type DepotCreateDialogProps = {
  onCreate: (values: DepotCreateInput) => Promise<Record<string, string> | null>;
};

export function DepotCreateDialog({ onCreate }: DepotCreateDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  // Synchronous guard against a double-click racing two POSTs before React's
  // disabled state re-renders (same pattern as the other COMDIS creation forms).
  const savingRef = React.useRef(false);

  // Reset the form whenever the dialog is opened or closed - done in the
  // open-change handler rather than an effect so no setState cascade runs
  // after render (react-hooks/set-state-in-effect).
  function handleOpenChange(next: boolean) {
    setOpen(next);
    setName("");
    setFieldErrors({});
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;

    savingRef.current = true;
    setSaving(true);
    try {
      const errors = await onCreate({ name: name.trim() });
      if (!errors) {
        handleOpenChange(false);
        return;
      }
      setFieldErrors(errors);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={<Button type="button" size="lg" className="w-full sm:w-auto" />}
      >
        <Plus aria-hidden="true" className="h-4 w-4" />
        Nouveau dépôt
      </DialogTrigger>

      <DialogContent className="flex flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">Nouveau dépôt</DialogTitle>
          <DialogDescription>
            Renseignez le nom du dépôt. Son code et son emplacement de stock sont
            générés automatiquement pour votre organisation.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-5">
          <div className="space-y-2">
            <Label htmlFor="depotName">Nom du dépôt</Label>
            <Input
              id="depotName"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setFieldErrors((current) => ({ ...current, name: "" }));
              }}
              placeholder="Dépôt Principal"
              autoFocus
              aria-invalid={!!fieldErrors.name}
            />
            {fieldErrors.name && (
              <p className="text-xs text-destructive">{fieldErrors.name}</p>
            )}
            {fieldErrors.form && (
              <p className="text-xs text-destructive">{fieldErrors.form}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={saving}
            >
              Annuler
            </Button>
            <Button type="submit" disabled={saving || name.trim().length === 0}>
              {saving ? "Création..." : "Créer le dépôt"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
