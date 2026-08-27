"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const customerTypes = [
  ["GROCERY", "Epicerie"],
  ["CAFE", "Cafe"],
  ["RESTAURANT", "Restaurant"],
  ["SUPERMARKET", "Supermarche"],
  ["WHOLESALER", "Grossiste"],
  ["COUNTER", "Client comptoir"],
  ["OTHER", "Autre"],
] as const;

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
            setShowForm(true);
          }}
        >
          <Plus className="h-4 w-4" />
          Nouveau client
        </Button>
      </div>

      {(showForm || editing) && (
        <CustomerForm
          customer={editing}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
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
                  setShowForm(true);
                }}
              >
                Modifier la fiche
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

function CustomerForm({
  customer,
  onCancel,
  onSave,
}: {
  customer?: CustomerDto | null;
  onCancel: () => void;
  onSave: (input: CustomerMutationInput, id?: string) => Promise<Record<string, string> | null>;
}) {
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  async function action(formData: FormData) {
    const input: CustomerMutationInput = {
      name: String(formData.get("name") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      email: String(formData.get("email") ?? "") || null,
      address: String(formData.get("address") ?? ""),
      city: String(formData.get("city") ?? ""),
      type: String(formData.get("type") ?? "OTHER"),
      creditLimit: Number(formData.get("creditLimit") ?? 0),
      ice: String(formData.get("ice") ?? "") || null,
      taxId: String(formData.get("taxId") ?? "") || null,
      contactName: String(formData.get("contactName") ?? "") || null,
      notes: String(formData.get("notes") ?? "") || null,
    };
    setErrors((await onSave(input, customer?.id)) ?? {});
  }

  return (
    <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
      <CardContent>
        <form action={action} className="grid gap-4 md:grid-cols-2">
          <Field label="Nom" error={errors.name}><Input name="name" defaultValue={customer?.name} required /></Field>
          <Field label="Telephone" error={errors.phone}><Input name="phone" defaultValue={customer?.phone} required /></Field>
          <Field label="Adresse" error={errors.address}><Input name="address" defaultValue={customer?.address} required /></Field>
          <Field label="Ville" error={errors.city}><Input name="city" defaultValue={customer?.city} required /></Field>
          <Field label="Type">
            <select name="type" defaultValue={customer?.type ?? "GROCERY"} className="h-9 rounded-lg border border-input bg-background px-3 text-sm">
              {customerTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="Email" error={errors.email}><Input name="email" type="email" defaultValue={customer?.email ?? ""} /></Field>
          <Field label="ICE"><Input name="ice" defaultValue={customer?.ice ?? ""} /></Field>
          <Field label="Identifiant fiscal"><Input name="taxId" defaultValue={customer?.taxId ?? ""} /></Field>
          <Field label="Contact principal"><Input name="contactName" defaultValue={customer?.contactName ?? ""} /></Field>
          <Field label="Plafond credit"><Input name="creditLimit" type="number" min={0} defaultValue={customer?.creditLimit ?? 0} /></Field>
          <div className="space-y-2 md:col-span-2">
            <Label>Notes</Label>
            <Input name="notes" defaultValue={customer?.notes ?? ""} />
          </div>
          {errors.form && <p className="text-sm text-destructive md:col-span-2">{errors.form}</p>}
          <div className="flex gap-2 md:col-span-2">
            <Button type="submit">Enregistrer</Button>
            <Button type="button" variant="outline" onClick={onCancel}>Annuler</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}{error && <p className="text-xs text-destructive">{error}</p>}</div>;
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
