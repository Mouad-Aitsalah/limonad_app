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
import {
  useDriverCustomersPage,
  type DriverCustomersFetchPage,
} from "@/components/driver-clients/use-driver-customers-page";
import { DriverRuntimeContext } from "@/hooks/use-driver-runtime";
import { cn, formatCurrency } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  CustomerDto,
  CustomerMutationInput,
  DriverCustomersPageDto,
} from "@/types/operations-dto";

const SEARCH_DEBOUNCE_MS = 400;

/** Outcome of saving a customer from the full form (POST /api/driver/customers). */
export type SaveCustomerResponse = {
  ok: boolean;
  payload: {
    customer?: CustomerDto;
    message?: string;
    fieldErrors?: Record<string, string>;
  };
};

/** Transport for the full form's save request. Omitted (the web app) -> the
 *  same-origin, cookie-authenticated fetch below; the Android shell injects a
 *  Bearer one (POST /api/driver/customers accepts both). */
export type SaveCustomerRequest = (body: Record<string, unknown>) => Promise<SaveCustomerResponse>;

const postCustomer: SaveCustomerRequest = async (body) => {
  const response = await fetch("/api/driver/customers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as SaveCustomerResponse["payload"];
  return { ok: response.ok, payload };
};

/**
 * PHASE 1 "RESTAURATION DU POS CHAUFFEUR" - ÉTAPE 21 - "1. UPSERT CUSTOMER
 * DANS LE RUNTIME": the only DriverRuntimeContextValue member this file
 * actually reads (refreshing the GPS-proximity candidate pool right after a
 * save) - never the whole context. Same narrowing already applied to
 * DriverPosRuntime (driver-pos-view.tsx's own ÉTAPE 7).
 */
type DriverClientsRuntime = {
  upsertCustomer: (customer: CustomerDto) => void;
};

/**
 * ÉTAPE 21 - discovered incompatibility, same shape as driver-pos-view.tsx's
 * own ÉTAPE 8: useDriverRuntime() THROWS with no <DriverRuntimeProvider>
 * ancestor - the mobile shell never mounts one (no GPS/tour runtime exists
 * there yet - see Étape 18's own GPS audit). A no-op upsert here is a
 * faithful "this shell has no GPS-proximity feed to refresh", never a
 * fabricated behavior. Never reached on the web (that page is always
 * rendered under a real provider - see components/driver/driver-runtime-
 * boundary.tsx).
 */
const NOOP_DRIVER_CLIENTS_RUNTIME: DriverClientsRuntime = {
  upsertCustomer: () => {},
};

export function DriverClientsView({
  initialPage,
  initialSelectedCustomerId,
  fetchCustomersPage,
  onCreateSale,
  disableCustomerManagement,
  saveCustomerRequest,
  disableCustomerEditing,
}: {
  initialPage?: DriverCustomersPageDto;
  initialSelectedCustomerId?: string | null;
  /** ÉTAPE 21 - see DriverCustomersFetchPage's own doc comment. Omitted
   *  (every existing web call site) -> today's exact same-origin fetch. */
  fetchCustomersPage?: DriverCustomersFetchPage;
  /** ÉTAPE 21 - "2. FAIRE UNE VENTE": omitted (every existing web call site)
   *  -> router.push, byte-for-byte as before this prop existed. The shell
   *  has no Next router (next/navigation is shimmed there - see mobile/
   *  driver/src/shims/next-navigation.ts) so it injects its own screen
   *  switch instead. */
  onCreateSale?: (customerId: string) => void;
  /** ÉTAPE 21 - "3. CRÉER/MODIFIER HORS PÉRIMÈTRE ANDROID": omitted (every
   *  existing web call site) -> "Nouveau client"/"Modifier la fiche"/
   *  "Ajouter la localisation" open the form exactly as before. A non-null
   *  string disables all four of those entry points and shows this message
   *  instead - never opens the form - see this component's own
   *  openCustomerForm helper. The shell passes one because POST /api/driver/
   *  customers has no Bearer/CORS path yet and location capture needs GPS
   *  infrastructure this shell doesn't have (see Étape 21's own audit) -
   *  deliberately NOT solved here, never silently faked. */
  disableCustomerManagement?: string;
  /** Android shell: see SaveCustomerRequest. Omitted -> today's same-origin fetch. */
  saveCustomerRequest?: SaveCustomerRequest;
  /** Android shell: a non-null string blocks ONLY editing an existing customer
   *  ("Modifier la fiche" / "Ajouter la localisation") with this message -
   *  "Nouveau client" (the full creation form) stays available. Omitted (the web
   *  app) -> nothing is blocked. Unlike disableCustomerManagement, which blocks
   *  every entry point, creation is not affected. */
  disableCustomerEditing?: string;
}) {
  // Rules of Hooks: useRouter() is still called unconditionally on every
  // render, exactly like useAuth()/useDriverRuntime() elsewhere - only
  // WHETHER its result is actually used depends on `onCreateSale`. On the
  // shell, next/navigation resolves to a harmless shim (see that file's own
  // doc comment) whose router.push is never actually reached, since
  // onCreateSale is always supplied there.
  const router = useRouter();
  const liveDriverRuntime = React.useContext(DriverRuntimeContext) ?? NOOP_DRIVER_CLIENTS_RUNTIME;
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const {
    items: customers,
    totalAccessibleCustomers,
    activeCount,
    blockedCount,
    ownCreatedCount,
    guaranteedCustomer,
    pageIndex,
    hasMore,
    hasPrevious,
    loading,
    goToNextPage,
    goToPreviousPage,
    refetchCurrentPage,
    resetToFirstPage,
  } = useDriverCustomersPage({ search: debouncedSearch }, initialPage, fetchCustomersPage);

  const [editing, setEditing] = React.useState<CustomerDto | null>(null);
  const [showForm, setShowForm] = React.useState(false);
  const [focusLocation, setFocusLocation] = React.useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = React.useState<string | null>(
    initialSelectedCustomerId ?? null,
  );

  /** ÉTAPE 21 - the ONE place all four "open the create/edit form" entry
   *  points (header button, detail card's two buttons, table row button) now
   *  go through, so disableCustomerManagement only ever needs checking once. */
  function openCustomerForm(customer: CustomerDto | null, focusLoc: boolean) {
    if (disableCustomerManagement) {
      toast.error(disableCustomerManagement);
      return;
    }
    if (disableCustomerEditing && customer) {
      toast.error(disableCustomerEditing);
      return;
    }
    setEditing(customer);
    setFocusLocation(focusLoc);
    setShowForm(true);
  }

  // CRITICAL #2 follow-up: `customers` is now one bounded page, not every
  // accessible customer - a selection can point at a row on another page
  // (row click) or outside pagination entirely (the ?customerId= deep link,
  // resolved server-side as guaranteedCustomer - see getDriverCustomersPage's
  // doc comment). Both are checked so the detail card above the table never
  // silently disappears just because its row scrolled off the current page.
  const selectedCustomer = React.useMemo(() => {
    if (!selectedCustomerId) return null;
    return (
      customers.find((customer) => customer.id === selectedCustomerId) ??
      (guaranteedCustomer?.id === selectedCustomerId ? guaranteedCustomer : null)
    );
  }, [customers, guaranteedCustomer, selectedCustomerId]);

  async function saveCustomer(input: CustomerMutationInput, id?: string) {
    const { ok, payload } = await (saveCustomerRequest ?? postCustomer)({ ...input, id });
    if (!ok || !payload.customer) {
      toast.error(payload.message ?? "Impossible d'enregistrer le client.");
      return payload.fieldErrors ?? { form: payload.message ?? "Erreur inconnue." };
    }
    const savedCustomer = payload.customer;
    setSelectedCustomerId(savedCustomer.id);
    liveDriverRuntime.upsertCustomer(savedCustomer);
    // A new customer sorts first (createdAt desc) - jump back to page 1 so
    // it's immediately visible. An edit's row is already on the current
    // page - just refresh it in place.
    if (id) {
      await refetchCurrentPage();
    } else {
      await resetToFirstPage();
    }
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
        <Button type="button" onClick={() => openCustomerForm(null, false)}>
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
                  onCreateSale
                    ? onCreateSale(selectedCustomer.id)
                    : router.push(`/driver/pos?customerId=${encodeURIComponent(selectedCustomer.id)}`)
                }
              >
                Faire une vente
              </Button>
              <Button
                type="button"
                variant="outline"
                className="rounded-2xl"
                disabled={selectedCustomer.creationOrigin !== "DRIVER"}
                onClick={() => openCustomerForm(selectedCustomer, false)}
              >
                Modifier la fiche
              </Button>
              <Button
                type="button"
                variant="outline"
                className="rounded-2xl"
                disabled={selectedCustomer.creationOrigin !== "DRIVER"}
                onClick={() => openCustomerForm(selectedCustomer, true)}
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
        <Metric label="Total clients" value={totalAccessibleCustomers} />
        <Metric label="Actifs" value={activeCount} />
        <Metric label="Bloques" value={blockedCount} />
        <Metric label="Ajoutes par vous" value={ownCreatedCount} />
      </div>

      <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Rechercher par nom, code, telephone..."
              className="sm:max-w-sm"
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!hasPrevious || loading}
                onClick={goToPreviousPage}
              >
                Precedent
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!hasMore || loading}
                onClick={goToNextPage}
              >
                Suivant
              </Button>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            Page {pageIndex + 1} - {customers.length} sur cette page
          </p>

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
              {customers.map((customer) => (
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
                        openCustomerForm(customer, false);
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
