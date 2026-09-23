import { PackageSearch, Truck } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DriverTruckStockDto } from "@/lib/server/driver-stock";
import { formatCurrency } from "@/lib/utils";

/**
 * ÉTAPE 23 - narrowed to only the members this component actually reads
 * (never `sessionUser`/`driver` - see the JSX below) so the Android shell can
 * supply a stock snapshot reconstructed from its own offline cache without
 * fabricating a fake CurrentUser. The web page (app/driver/stock/page.tsx)
 * still passes the full DriverTruckStockDto unchanged - a structural subtype,
 * so nothing there needed to change.
 */
export type DriverStockViewStock = Pick<DriverTruckStockDto, "truck" | "location" | "levels">;

export function DriverStockView({ stock }: { stock: DriverStockViewStock }) {
  const rows = stock.levels.filter((level) => level.quantity > 0);
  const totalQuantity = rows.reduce((sum, row) => sum + row.quantity, 0);
  const totalValue = rows.reduce((sum, row) => sum + row.stockValue, 0);
  const truckName = [stock.truck.brand, stock.truck.model]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            Mon stock
          </h1>
          <p className="text-sm text-muted-foreground">
            Stock actuellement charge sur votre camion.
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card px-4 py-3 text-sm shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
          <p className="font-medium text-foreground">
            {stock.truck.code}
            {truckName ? ` - ${truckName}` : ""}
          </p>
          <p className="text-muted-foreground">
            Immatriculation : {stock.truck.registration}
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Produits disponibles" value={String(rows.length)} />
        <MetricCard label="Quantite totale" value={String(totalQuantity)} />
        <MetricCard label="Valeur du stock" value={formatCurrency(totalValue)} />
      </div>

      {/* Mobile card padding tightened (12px vs the default 24px) ONLY on
          this instance via --card-spacing, same technique and same margin
          this task applies to driver-clients-view.tsx's table card - not a
          change to the shared Card component. Reverts to 24px at lg. */}
      <Card className="[--card-spacing:--spacing(3)] ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)] lg:[--card-spacing:--spacing(6)]">
        <CardContent className="space-y-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
              <Truck aria-hidden="true" className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-heading text-lg font-semibold text-foreground">
                {stock.location.name}
              </h2>
              <p className="text-sm text-muted-foreground">
                Meme source de stock PostgreSQL que la page administrateur /stock.
              </p>
            </div>
          </div>

          {rows.length === 0 ? (
            <EmptyState message="Aucun produit disponible dans votre camion." />
          ) : (
            /* Mobile (<lg): Produit / Quantite only - Disponible, Valeur and
               Derniere mise a jour stay in the DOM (data untouched) but
               hidden via `hidden lg:table-cell`, same breakpoint convention
               as driver-clients-view.tsx's own responsive table. Desktop
               (>=lg) is byte-for-byte unchanged. */
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-2 lg:px-4">Produit</TableHead>
                  <TableHead className="px-2 text-right lg:px-4">Quantite</TableHead>
                  <TableHead className="hidden lg:table-cell lg:text-right">Disponible</TableHead>
                  <TableHead className="hidden lg:table-cell lg:text-right">Valeur</TableHead>
                  <TableHead className="hidden lg:table-cell lg:text-right">Derniere mise a jour</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="max-w-[52vw] px-2 lg:max-w-none lg:px-4">
                      <div className="truncate font-medium text-foreground">
                        {row.productName}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {row.productReference}
                      </div>
                    </TableCell>
                    <TableCell className="px-2 text-right font-medium tabular-nums lg:px-4">
                      {row.quantity}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">
                      {row.availableQuantity}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">
                      {formatCurrency(row.stockValue)}
                    </TableCell>
                    <TableCell className="hidden text-right text-muted-foreground lg:table-cell">
                      {new Date(row.updatedAt).toLocaleDateString("fr-FR")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function DriverStockUnavailable({ message }: { message: string }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Mon stock
        </h1>
        <p className="text-sm text-muted-foreground">
          Stock actuellement charge sur votre camion.
        </p>
      </div>

      <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
        <CardContent>
          <EmptyState message={message} />
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
      <CardContent className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p className="font-heading text-2xl font-semibold text-foreground">
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <PackageSearch
        aria-hidden="true"
        className="h-10 w-10 text-muted-foreground/40"
      />
      <p className="max-w-md text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
