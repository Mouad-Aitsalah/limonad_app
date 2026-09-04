"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTableShell } from "@/components/ui/data-table-shell";
import type { DirectionTopProductRow, DirectionTopProducts } from "@/types/dashboard-direction";

function ProductsTable({ rows }: { rows: DirectionTopProductRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-sm text-muted-foreground">
        Aucune vente sur cette periode.
      </p>
    );
  }

  return (
    // Own overflow-x-auto boundary - a <table> never shrinks below its
    // content's natural width, and wrapping this table in <Tabs> (a flex
    // container) let that width bubble up into the page on narrow
    // viewports without this (see spec §23: tables/charts scroll inside
    // their own container, the page itself never scrolls horizontally).
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Produit</TableHead>
            <TableHead>Categorie</TableHead>
            <TableHead className="text-right">Quantite</TableHead>
            <TableHead className="text-right">CA</TableHead>
            <TableHead className="text-right">Marge</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.productId}>
              <TableCell className="font-medium text-foreground">{row.name}</TableCell>
              <TableCell className="text-muted-foreground">{row.category}</TableCell>
              <TableCell className="text-right">{row.quantity.toLocaleString("fr-FR")}</TableCell>
              <TableCell className="text-right font-semibold">{row.ca}</TableCell>
              <TableCell className="text-right font-semibold">{row.margin}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function DirectionTopProductsCard({ data }: { data: DirectionTopProducts }) {
  return (
    <Tabs defaultValue="revenue" className="min-w-0">
      <DataTableShell
        title="Top Produits"
        description="Top 10 sur la periode selectionnee."
        className="h-full min-w-0"
        toolbar={
          <TabsList>
            <TabsTrigger value="revenue">CA</TabsTrigger>
            <TabsTrigger value="margin">Marge</TabsTrigger>
            <TabsTrigger value="quantity">Quantite</TabsTrigger>
          </TabsList>
        }
      >
        <TabsContent value="revenue">
          <ProductsTable rows={data.byRevenue} />
        </TabsContent>
        <TabsContent value="margin">
          <ProductsTable rows={data.byMargin} />
        </TabsContent>
        <TabsContent value="quantity">
          <ProductsTable rows={data.byQuantity} />
        </TabsContent>
      </DataTableShell>
    </Tabs>
  );
}
