"use client";

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency } from "@/lib/utils";
import type { CustomerDto, SupplierPartnerDto } from "@/types/operations-dto";

type CustomersAdminViewProps = {
  initialCustomers: CustomerDto[];
  initialSuppliers: SupplierPartnerDto[];
};

export function CustomersAdminView({
  initialCustomers,
  initialSuppliers,
}: CustomersAdminViewProps) {
  const [customerSearch, setCustomerSearch] = React.useState("");
  const [supplierSearch, setSupplierSearch] = React.useState("");

  const filteredCustomers = React.useMemo(() => {
    const query = normalizeSearch(customerSearch);
    return initialCustomers.filter((customer) =>
      normalizeSearch(
        `${customer.name} ${customer.code} ${customer.phone} ${customer.city}`,
      ).includes(query),
    );
  }, [initialCustomers, customerSearch]);

  const filteredSuppliers = React.useMemo(() => {
    const query = normalizeSearch(supplierSearch);
    return initialSuppliers.filter((supplier) =>
      normalizeSearch(
        `${supplier.name} ${supplier.code} ${supplier.phone ?? ""} ${
          supplier.email ?? ""
        } ${supplier.city ?? ""}`,
      ).includes(query),
    );
  }, [initialSuppliers, supplierSearch]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Clients
        </h1>
        <p className="text-sm text-muted-foreground">
          Gestion des clients et fournisseurs connectes a PostgreSQL.
        </p>
      </div>

      <Tabs defaultValue="clients" className="space-y-4">
        <TabsList>
          <TabsTrigger value="clients">Clients</TabsTrigger>
          <TabsTrigger value="suppliers">Fournisseurs</TabsTrigger>
        </TabsList>

        <TabsContent value="clients">
          <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
            <CardContent className="space-y-4">
              <Input
                value={customerSearch}
                onChange={(event) => setCustomerSearch(event.target.value)}
                placeholder="Rechercher un client"
              />
              <CustomersTable customers={filteredCustomers} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="suppliers">
          <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
            <CardContent className="space-y-4">
              <Input
                value={supplierSearch}
                onChange={(event) => setSupplierSearch(event.target.value)}
                placeholder="Rechercher un fournisseur"
              />
              <SuppliersTable suppliers={filteredSuppliers} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CustomersTable({ customers }: { customers: CustomerDto[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Client</TableHead>
          <TableHead>Telephone</TableHead>
          <TableHead>Ville</TableHead>
          <TableHead>Origine</TableHead>
          <TableHead className="text-right">Credit</TableHead>
          <TableHead>Statut</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {customers.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
              Aucun client trouve.
            </TableCell>
          </TableRow>
        ) : (
          customers.map((customer) => (
            <TableRow key={customer.id}>
              <TableCell>
                <div className="font-medium">{customer.name}</div>
                <div className="text-xs text-muted-foreground">{customer.code}</div>
              </TableCell>
              <TableCell>{customer.phone}</TableCell>
              <TableCell>{customer.city}</TableCell>
              <TableCell>{customer.creationOrigin}</TableCell>
              <TableCell className="text-right">
                {formatCurrency(customer.currentBalance)}
              </TableCell>
              <TableCell>
                <StatusBadge active={customer.status !== "BLOCKED"} label={customer.status} />
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function SuppliersTable({ suppliers }: { suppliers: SupplierPartnerDto[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Fournisseur</TableHead>
          <TableHead>Telephone</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Ville</TableHead>
          <TableHead>Adresse</TableHead>
          <TableHead className="text-right">Produits</TableHead>
          <TableHead className="text-right">Achats</TableHead>
          <TableHead>Statut</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {suppliers.length === 0 ? (
          <TableRow>
            <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
              Aucun fournisseur trouve.
            </TableCell>
          </TableRow>
        ) : (
          suppliers.map((supplier) => (
            <TableRow key={supplier.id}>
              <TableCell>
                <div className="font-medium">{supplier.name}</div>
                <div className="text-xs text-muted-foreground">{supplier.code}</div>
              </TableCell>
              <TableCell>{supplier.phone ?? "-"}</TableCell>
              <TableCell>{supplier.email ?? "-"}</TableCell>
              <TableCell>{supplier.city ?? "-"}</TableCell>
              <TableCell className="max-w-[260px] truncate">
                {supplier.address ?? "-"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {supplier.productsCount}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {supplier.purchasesCount}
              </TableCell>
              <TableCell>
                <StatusBadge
                  active={supplier.active}
                  label={supplier.active ? "Actif" : "Inactif"}
                />
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function StatusBadge({ active, label }: { active: boolean; label: string }) {
  return (
    <Badge variant={active ? "secondary" : "destructive"}>
      {label}
    </Badge>
  );
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}
