"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { driverCustomerTypes as customerTypes } from "@/components/driver-clients/driver-customer-form";
import { DriverCustomerForm } from "@/components/driver-clients/driver-customer-form";
import { Input } from "@/components/ui/input";
import { useDriverRuntime } from "@/hooks/use-driver-runtime";
import { cn, formatCurrency } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CustomerDto, CustomerMutationInput } from "@/types/operations-dto";

export function DriverClientsView({
  initialCustomers,
  initialSelectedCustomerId,
}: {
  initialCustomers: CustomerDto[];
  initialSelectedCustomerId?: string | null;
}) {
  const router = useRouter();
  const driverRuntime = useDriverRuntime();
  const [customers, setCustomers] = React.useState(initialCustomers);
  const [search, setSearch] = React.useState("");
  const [editing, setEditing] = React.useState<CustomerDto | null>(null);
  const [showForm, setShowForm] = React.useState(false);
  const [focusLocation, setFocusLocation] = React.useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = React.useState<string | null>(() =>
    resolveInitialSelectedCustomerId(initialCustomers, initialSelectedCustomerId),
  );

  const filtered = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    return customers.filter((customer) =>
      `${customer.name} ${customer.code} ${customer.phone} ${customer.city}`
        .toLowerCase()
        .includes(query),
    );
  }, [customers, search]);
  const selectedCustomer = React.useMemo(
    () => customers.find((customer) => customer.id === selectedCustomerId) ?? null,
    [customers, selectedCustomerId],
  );

  async function saveCustomer(input: CustomerMutationInput, id?: string) {
    const response = await fetch("/api/driver/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, id }),
    });
    const payload = (await response.json()) as {
      customer?: CustomerDto;
      message?: string;
      fieldErrors?: Record<string, string>;
    };
    if (!response.ok || !payload.customer) {
      toast.error(payload.message ?? "Impossible d'enregistrer le client.");
      return payload.fieldErrors ?? { form: payload.message ?? "Erreur inconnue." };
    }
    const savedCustomer = payload.customer;
    setCustomers((current) => upsertCustomer(current, savedCustomer));
    setSelectedCustomerId(savedCustomer.id);
    driverRuntime.upsertCustomer(savedCustomer);
    setEditing(null);
    setShowForm(false);
    setFocusLocation(false);
    toast.success(id ? "Client modifie avec succes" : "Client ajoute avec succes");
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            Mes clients
          </h1>
          <p className="text-sm text-muted-foreground">
            Clients associes a votre activite et a vos tournees.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => {
            setEditing(null);
            setFocusLocation(false);
            setShowForm(true);
          }}
        >
          <Plus className="h-4 w-4" />
          Nouveau client
        </Button>
      </div>

      {(showForm || editing) && (
        <DriverCustomerForm
          key={editing?.id ?? "new"}
          customer={editing}
          focusLocation={focusLocation}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
            setFocusLocation(false);
          }}
          onSave={saveCustomer}
        />
      )}

      {selectedCustomer ? (
        <Card className="border-emerald-200 bg-emerald-50/70 ring-0 shadow-[0_10px_30px_rgba(16,185,129,0.12)]">
          <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.22em] text-emerald-700/80">
                Client selectionne
              </p>
              <div>
                <h2 className="font-heading text-xl font-semibold text-foreground">
                  {selectedCustomer.name}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {selectedCustomer.code} - {selectedCustomer.phone}
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                {selectedCustomer.address}, {selectedCustomer.city}
              </p>
              <p className="text-xs text-muted-foreground">
                {hasCustomerLocation(selectedCustomer)
                  ? `Position : ${selectedCustomer.latitude!.toFixed(5)}, ${selectedCustomer.longitude!.toFixed(5)}${
                      selectedCustomer.locationAccuracy
                        ? ` (+/-${Math.round(selectedCustomer.locationAccuracy)} m)`
                        : ""
                    }`
                  : "Localisation non renseignee"}
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:min-w-[220px]">
              <Button
                type="button"
                className="rounded-2xl"
                onClick={() =>
                  router.push(
                    `/driver/pos?customerId=${encodeURIComponent(selectedCustomer.id)}`,
                  )
                }
              >
                Faire une vente
              </Button>
              <Button
                type="button"
                variant="outline"
                className="rounded-2xl"
                disabled={selectedCustomer.creationOrigin !== "DRIVER"}
                onClick={() => {
                  setEditing(selectedCustomer);
                  setFocusLocation(false);
                  setShowForm(true);
                }}
              >
                Modifier la fiche
              </Button>
              <Button
                type="button"
                variant="outline"
                className="rounded-2xl"
                disabled={selectedCustomer.creationOrigin !== "DRIVER"}
                onClick={() => {
                  setEditing(selectedCustomer);
                  setFocusLocation(true);
                  setShowForm(true);
                }}
              >
                {hasCustomerLocation(selectedCustomer)
                  ? "Mettre a jour la localisation"
                  : "Ajouter la localisation"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        <Metric label="Total clients" value={customers.length} />
        <Metric label="Actifs" value={customers.filter((c) => c.status === "ACTIVE").length} />
        <Metric label="Bloques" value={customers.filter((c) => c.status === "BLOCKED").length} />
        <Metric label="Ajoutes par vous" value={customers.filter((c) => c.creationOrigin === "DRIVER").length} />
      </div>

      <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
        <CardContent className="space-y-4">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Rechercher un client"
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Telephone</TableHead>
                <TableHead>Adresse</TableHead>
                <TableHead>Ville</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Credit</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((customer) => (
                <TableRow
                  key={customer.id}
                  className={cn(
                    "cursor-pointer transition-colors hover:bg-muted/50",
                    selectedCustomerId === customer.id && "bg-emerald-50/70",
                  )}
                  onClick={() => setSelectedCustomerId(customer.id)}
                >
                  <TableCell className="font-medium">{customer.name}</TableCell>
                  <TableCell>{customer.code}</TableCell>
                  <TableCell>{customer.phone}</TableCell>
                  <TableCell className="max-w-[220px] truncate">{customer.address}</TableCell>
                  <TableCell>{customer.city}</TableCell>
                  <TableCell>{typeLabel(customer.type)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(customer.currentBalance)}</TableCell>
                  <TableCell>
                    <Badge variant={customer.status === "BLOCKED" ? "destructive" : "secondary"}>
                      {customer.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={customer.creationOrigin !== "DRIVER"}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedCustomerId(customer.id);
                        setEditing(customer);
                        setShowForm(true);
                      }}
                    >
                      Modifier
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function hasCustomerLocation(customer: CustomerDto) {
  return customer.latitude !== null && customer.latitude !== undefined
    && customer.longitude !== null && customer.longitude !== undefined;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]"><CardContent><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></CardContent></Card>;
}

function typeLabel(value: string) {
  return customerTypes.find(([type]) => type === value)?.[1] ?? value;
}

function upsertCustomer(customers: CustomerDto[], customer: CustomerDto) {
  const existingIndex = customers.findIndex((item) => item.id === customer.id);

  if (existingIndex === -1) {
    return sortCustomersByName([customer, ...customers]);
  }

  const nextCustomers = [...customers];
  nextCustomers[existingIndex] = customer;
  return sortCustomersByName(nextCustomers);
}

function sortCustomersByName(customers: CustomerDto[]) {
  return [...customers].sort((left, right) =>
    left.name.localeCompare(right.name, "fr-FR"),
  );
}

function resolveInitialSelectedCustomerId(
  customers: CustomerDto[],
  initialSelectedCustomerId?: string | null,
) {
  if (!initialSelectedCustomerId) {
    return null;
  }

  return customers.some((customer) => customer.id === initialSelectedCustomerId)
    ? initialSelectedCustomerId
    : null;
}
