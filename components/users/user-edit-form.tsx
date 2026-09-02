"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { roleLabels } from "@/lib/roles";
import type { DepotDto, TruckDto } from "@/types/operations-dto";
import type { User } from "@/types/user";

// Base UI's Select needs a non-empty sentinel for "no selection" - it can't
// be tied to an empty string, which SelectItem treats as invalid.
const UNASSIGNED = "__none__";

// Non-driver roles for which assigning a depot is meaningful (POS,
// versements). "super_admin" has no depot-scoped screens; "driver" is
// scoped through Truck/Driver instead.
const DEPOT_ROLES: User["role"][] = ["admin", "cashier", "depot_manager"];

type UserEditFormProps = {
  user: User;
  onCancel: () => void;
  onSaved: (user: User) => void;
};

export function UserEditForm({ user, onCancel, onSaved }: UserEditFormProps) {
  const isDriver = user.role === "driver" && !!user.driver;
  const canAssignDepot = DEPOT_ROLES.includes(user.role);

  const [trucks, setTrucks] = React.useState<TruckDto[]>([]);
  // Starts true whenever a driver is being edited so the fetch below only
  // ever flips it to false in a callback - never a synchronous setState
  // call in the effect body itself. Remounting via `key={user.id}` (see
  // user-edit-dialog.tsx) resets this for every user opened.
  const [loadingTrucks, setLoadingTrucks] = React.useState(isDriver);
  const [selectedTruckId, setSelectedTruckId] = React.useState(
    () => user.driver?.truck?.id ?? UNASSIGNED,
  );

  const [depots, setDepots] = React.useState<DepotDto[]>([]);
  const [loadingDepots, setLoadingDepots] = React.useState(canAssignDepot);
  const [selectedDepotId, setSelectedDepotId] = React.useState(
    () => user.depotId ?? UNASSIGNED,
  );

  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  // Synchronous guard against a double-click racing two PATCHes before
  // React's disabled state re-renders (same pattern as the other COMDIS
  // creation/edit forms).
  const savingRef = React.useRef(false);

  React.useEffect(() => {
    if (!isDriver) return;
    let cancelled = false;

    fetch("/api/trucks")
      .then((response) => response.json())
      .then((data: { trucks?: TruckDto[] }) => {
        if (!cancelled) setTrucks(data.trucks ?? []);
      })
      .catch(() => {
        if (!cancelled) setTrucks([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingTrucks(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isDriver]);

  React.useEffect(() => {
    if (!canAssignDepot) return;
    let cancelled = false;

    fetch("/api/depots")
      .then((response) => response.json())
      .then((data: { depots?: DepotDto[] }) => {
        if (!cancelled) setDepots((data.depots ?? []).filter((depot) => depot.active));
      })
      .catch(() => {
        if (!cancelled) setDepots([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingDepots(false);
      });

    return () => {
      cancelled = true;
    };
  }, [canAssignDepot]);

  // Only trucks with no driver, plus whichever truck this driver already
  // has (so switching away and back to it stays possible), can be picked -
  // a truck can only ever have one active driver (Driver.truckId is
  // @unique in the schema).
  const selectableTrucks = React.useMemo(
    () =>
      trucks.filter(
        (truck) => !truck.assignedDriver || truck.assignedDriver.id === user.driver?.id,
      ),
    [trucks, user.driver?.id],
  );

  async function handleSaveTruck() {
    if (!user.driver || savingRef.current) return;

    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const truckId = selectedTruckId === UNASSIGNED ? null : selectedTruckId;
      const response = await fetch(`/api/drivers/${user.driver.id}/truck`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ truckId }),
      });
      const result = (await response.json()) as {
        driver?: {
          id: string;
          truckId: string | null;
          truck: { id: string; code: string; registration: string } | null;
        };
        message?: string;
        fieldErrors?: Record<string, string>;
      };

      if (!response.ok || !result.driver) {
        const message = result.message ?? "Impossible d'affecter le camion.";
        setError(result.fieldErrors?.truckId ?? message);
        toast.error(message);
        return;
      }

      toast.success(
        result.driver.truck
          ? `Camion ${result.driver.truck.code} affecte a ${user.nom}.`
          : `Affectation retiree pour ${user.nom}.`,
      );
      onSaved({
        ...user,
        driver: { id: result.driver.id, truck: result.driver.truck },
      });
    } catch {
      setError("Impossible d'affecter le camion.");
      toast.error("Impossible d'affecter le camion.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function handleSaveDepot() {
    if (savingRef.current) return;

    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const depotId = selectedDepotId === UNASSIGNED ? null : selectedDepotId;
      const response = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ depotId }),
      });
      const result = (await response.json()) as {
        user?: User;
        message?: string;
        fieldErrors?: Record<string, string>;
      };

      if (!response.ok || !result.user) {
        const message = result.message ?? "Impossible de modifier l'utilisateur.";
        setError(result.fieldErrors?.depotId ?? message);
        toast.error(message);
        return;
      }

      toast.success(
        result.user.depotName
          ? `Dépôt ${result.user.depotName} affecté à ${user.nom}.`
          : `Dépôt retiré pour ${user.nom}.`,
      );
      onSaved(result.user);
    } catch {
      setError("Impossible de modifier l'utilisateur.");
      toast.error("Impossible de modifier l'utilisateur.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 space-y-4 overflow-y-auto px-1 py-1">
        <div className="grid gap-2.5 rounded-xl border border-border p-3 text-sm">
          <InfoRow label="Nom" value={user.nom} />
          <InfoRow label="Email" value={user.email} />
          <InfoRow label="Rôle" value={roleLabels[user.role]} />
        </div>

        {isDriver && (
          <div className="space-y-2">
            <Label>Camion affecté</Label>
            <Select
              value={selectedTruckId}
              onValueChange={(value) => value && setSelectedTruckId(value)}
              disabled={loadingTrucks}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Sélectionner">
                  {(value: string | null) =>
                    !value || value === UNASSIGNED
                      ? "Aucun camion"
                      : (trucks.find((truck) => truck.id === value)?.code ?? "Sélectionner")
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>Aucun camion</SelectItem>
                {selectableTrucks.map((truck) => (
                  <SelectItem key={truck.id} value={truck.id}>
                    {truck.code} — {truck.registration}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {canAssignDepot && (
          <div className="space-y-2">
            <Label>Dépôt actuel</Label>
            <Select
              value={selectedDepotId}
              onValueChange={(value) => value && setSelectedDepotId(value)}
              disabled={loadingDepots}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Sélectionner">
                  {(value: string | null) =>
                    !value || value === UNASSIGNED
                      ? "Aucun dépôt"
                      : (depots.find((depot) => depot.id === value)?.name ?? "Sélectionner")
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>Aucun dépôt</SelectItem>
                {depots.map((depot) => (
                  <SelectItem key={depot.id} value={depot.id}>
                    {depot.name} — {depot.city}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Requis pour le point de vente et les versements.
            </p>
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          {isDriver || canAssignDepot ? "Annuler" : "Fermer"}
        </Button>
        {isDriver && (
          <Button type="button" onClick={handleSaveTruck} disabled={saving || loadingTrucks}>
            {saving ? "Enregistrement..." : "Enregistrer le camion"}
          </Button>
        )}
        {canAssignDepot && (
          <Button type="button" onClick={handleSaveDepot} disabled={saving || loadingDepots}>
            {saving ? "Enregistrement..." : "Enregistrer le dépôt"}
          </Button>
        )}
      </DialogFooter>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
