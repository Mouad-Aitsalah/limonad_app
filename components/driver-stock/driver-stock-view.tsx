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

export function DriverStockView({ stock }: { stock: DriverTruckStockDto }) {
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

      <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produit</TableHead>
                  <TableHead className="text-right">Quantite</TableHead>
                  <TableHead className="text-right">Disponible</TableHead>
                  <TableHead className="text-right">Valeur</TableHead>
                  <TableHead className="text-right">Derniere mise a jour</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="font-medium text-foreground">
                        {row.productName}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {row.productReference}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {row.quantity}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.availableQuantity}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(row.stockValue)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
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
