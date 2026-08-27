"use client";

import * as React from "react";
import { AlertTriangle, ClipboardCheck, Eye, ListChecks, Plus, Wallet } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { InventoryCaptureDialog } from "@/components/inventory/inventory-capture-dialog";
import { InventoryStatusBadge } from "@/components/inventory/inventory-status-badge";
import { formatCurrency } from "@/lib/utils";
import type { DepotDto, InventoryDto, InventorySummaryDto } from "@/types/operations-dto";
import type { ProductDto } from "@/types/product-dto";

type InventoryViewProps = {
  initialInventories: InventorySummaryDto[];
  depots: DepotDto[];
  products: ProductDto[];
};

export function InventoryView({ initialInventories, depots, products }: InventoryViewProps) {
  const [inventories, setInventories] = React.useState(initialInventories);
  const [selectedDepotId, setSelectedDepotId] = React.useState(depots[0]?.id ?? "");
  const [busy, setBusy] = React.useState(false);
  const [activeInventory, setActiveInventory] = React.useState<InventoryDto | null>(null);
  const [dialogMode, setDialogMode] = React.useState<"capture" | "view">("capture");

  const totals = React.useMemo(
    () =>
      inventories.reduce(
        (acc, inventory) => {
          acc.count += 1;
          if (inventory.status === "EN_COURS") acc.inProgress += 1;
          acc.totalValue += inventory.totalValue;
          acc.totalDifference += inventory.totalDifference;
          return acc;
        },
        { count: 0, inProgress: 0, totalValue: 0, totalDifference: 0 },
      ),
    [inventories],
  );

  function upsertInventorySummary(inventory: InventoryDto) {
    setInventories((current) => {
      const summary: InventorySummaryDto = {
        id: inventory.id,
        number: inventory.number,
        displayNumber: inventory.displayNumber,
        status: inventory.status,
        depotId: inventory.depotId,
        depotName: inventory.depotName,
        createdByUserName: inventory.createdByUserName,
        createdAt: inventory.createdAt,
        finishedAt: inventory.finishedAt,
        linesCount: inventory.linesCount,
        totalValue: inventory.totalValue,
        totalStockBefore: inventory.totalStockBefore,
        totalDifference: inventory.totalDifference,
      };
      const exists = current.some((item) => item.id === summary.id);
      return exists
        ? current.map((item) => (item.id === summary.id ? summary : item))
        : [summary, ...current];
    });
  }

  async function createNewInventory() {
    if (!selectedDepotId) {
      toast.error("Selectionnez un depot.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/inventories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ depotId: selectedDepotId }),
      });
      const body = (await response.json()) as { inventory?: InventoryDto; message?: string };
      if (!response.ok || !body.inventory) {
        toast.error(body.message ?? "Impossible de creer l'inventaire.");
        return;
      }
      upsertInventorySummary(body.inventory);
      setActiveInventory(body.inventory);
      setDialogMode("capture");
    } finally {
      setBusy(false);
    }
  }

  async function openInventory(id: string, mode: "capture" | "view") {
    setBusy(true);
    try {
      const response = await fetch(`/api/inventories/${id}`, { cache: "no-store" });
      const body = (await response.json()) as { inventory?: InventoryDto; message?: string };
      if (!response.ok || !body.inventory) {
        toast.error(body.message ?? "Impossible de charger cet inventaire.");
        return;
      }
      setActiveInventory(body.inventory);
      setDialogMode(mode);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Inventaire</h1>
        <p className="text-sm text-muted-foreground">
          Comptage physique du stock, saisie rapide au clavier.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={ClipboardCheck} label="Inventaires" value={String(totals.count)} />
        <MetricCard icon={ListChecks} label="En cours" value={String(totals.inProgress)} />
        <MetricCard
          icon={Wallet}
          label="Valeur inventaire"
          value={formatCurrency(totals.totalValue)}
        />
        <MetricCard
          icon={AlertTriangle}
          label="Difference"
          value={String(totals.totalDifference)}
        />
      </div>

      <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-heading text-lg font-semibold">Historique des inventaires</h2>
              <p className="text-sm text-muted-foreground">
                Creez un nouvel inventaire ou reprenez un brouillon en cours.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              {depots.length > 1 ? (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Depot</Label>
                  <select
                    value={selectedDepotId}
                    onChange={(event) => setSelectedDepotId(event.target.value)}
                    className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-3 focus:ring-emerald-500/15"
                  >
                    {depots.map((depot) => (
                      <option key={depot.id} value={depot.id}>
                        {depot.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <Button type="button" disabled={busy} onClick={createNewInventory}>
                <Plus className="h-4 w-4" />
                Nouvel inventaire
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Numero</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Lignes</TableHead>
                  <TableHead className="text-right">Valeur inventaire</TableHead>
                  <TableHead className="text-right">Stock avant</TableHead>
                  <TableHead className="text-right">Difference</TableHead>
                  <TableHead>Utilisateur</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inventories.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                      Aucun inventaire pour le moment.
                    </TableCell>
                  </TableRow>
                ) : (
                  inventories.map((inventory) => (
                    <TableRow key={inventory.id}>
                      <TableCell className="font-medium text-foreground">
                        {inventory.displayNumber}
                      </TableCell>
                      <TableCell>
                        <InventoryStatusBadge status={inventory.status} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(inventory.createdAt).toLocaleString("fr-FR")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {inventory.linesCount}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(inventory.totalValue)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {inventory.totalStockBefore}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {inventory.totalDifference}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {inventory.createdByUserName}
                      </TableCell>
                      <TableCell className="text-right">
                        {inventory.status === "EN_COURS" ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => openInventory(inventory.id, "capture")}
                          >
                            Reprendre
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => openInventory(inventory.id, "view")}
                          >
                            <Eye className="h-4 w-4" />
                            Voir
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <InventoryCaptureDialog
        inventory={activeInventory}
        mode={dialogMode}
        products={products}
        open={activeInventory !== null}
        onOpenChange={(open) => {
          if (!open) setActiveInventory(null);
        }}
        onInventoryUpdated={upsertInventorySummary}
      />
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
      <CardContent className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="font-heading text-2xl font-semibold text-foreground">{value}</p>
        </div>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}
