"use client";

import * as React from "react";
import { LoaderCircle, MessageCircle, Receipt } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  InvoiceDetailDialog,
  type InvoiceDetailFetchOutcome,
} from "@/components/ventes/invoice-detail-dialog";
import { AuthContext } from "@/hooks/use-auth";
import { useCompanyIdentity, type CompanyIdentity } from "@/hooks/use-company-identity";
import { getOfflineSales, type OfflineSaleWithLines, type SyncStatus } from "@/lib/offline/driver-pos";
import { shareInvoicePdf } from "@/lib/share-invoice";
import { formatCurrency } from "@/lib/utils";
import type {
  CustomerDto,
  DriverTodaySalesDto,
  SaleDto,
  SaleHistoryListItemDto,
} from "@/types/operations-dto";

// Phase 3 - "14. MES VENTES": a today's-sales row is either a real,
// server-persisted sale or a still-local offline one - never the same
// shape, so the list merges both instead of forcing an offline sale into
// SaleDto (which would need a fake id/invoiceNumber it must never have -
// see this task's own "20. NUMÉROTATION").
type DisplayRow = { kind: "server"; sale: SaleDto } | { kind: "offline"; sale: OfflineSaleWithLines };

function isToday(iso: string): boolean {
  const date = new Date(iso);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

// Requirement 14's exact wording - not the un-accented set some other pages
// use (components/ventes/orders-toolbar.tsx's paymentMethodLabels), so the
// chauffeur reads "Espèces"/"Crédit", not "Especes"/"Credit".
const PAYMENT_LABELS: Record<string, string> = {
  CASH: "Espèces",
  CREDIT: "Crédit",
  BANK_TRANSFER: "Virement",
  CHECK: "Chèque",
  MIXED: "Mixte",
};

// ÉTAPE 25B - the real SyncStatus (lib/offline/driver-pos/types.ts) has
// exactly these 5 values - reused verbatim, never renamed/extended. Labels
// match components/... OfflineSalesScreen's own established French copy.
const OFFLINE_STATUS_LABEL: Record<Exclude<SyncStatus, "LOCAL_DRAFT">, string> = {
  PENDING_SYNC: "En attente",
  SYNCING: "Synchronisation...",
  SYNCED: "Synchronisée",
  SYNC_ERROR: "Erreur de synchronisation",
  REQUIRES_REVIEW: "À vérifier",
};

function formatDayLong(day: string): string {
  const [year, month, dayNum] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, dayNum));
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(
    new Date(iso),
  );
}

// InvoiceDetailDialog only needs this light shape - it re-fetches the full
// SaleDto itself (via fetchBase="/api/driver/sales", driver-scoped) the
// instant it opens. See that component's own doc comment.
function toListItem(sale: SaleDto): SaleHistoryListItemDto {
  return {
    id: sale.id,
    invoiceNumber: sale.invoiceNumber,
    displayNumber: sale.displayNumber,
    posSessionId: sale.posSessionId,
    status: sale.status,
    origin: sale.origin,
    customer: sale.customer ?? null,
    driver: sale.driver ?? null,
    articleCount: sale.lines.reduce((sum, line) => sum + line.quantity, 0),
    totalTTC: sale.totalTTC,
    net: sale.totalTTC,
    paidAmount: sale.paidAmount,
    creditAmount: sale.creditAmount,
    paymentMethod: sale.paymentMethod,
    createdByUserName: sale.createdByUserName,
    createdAt: sale.createdAt,
    updatedAt: sale.updatedAt ?? sale.createdAt,
  };
}

// ÉTAPE 25I - "9. DÉTAIL D'UNE VENTE": a SYNCED offline sale already has a
// real serverSaleId/officialDisplayNumber - this is only a transient
// skeleton shown while InvoiceDetailDialog's own fetchSale(id) loads the
// REAL SaleDto (same "net"/"articleCount" on-the-fly-computed pattern as
// toListItem above). Never persisted, never shown beyond that brief
// loading flash - status/origin/createdByUserName are reasonable
// placeholders for a CASH offline sale (the only kind this app creates
// offline - see lib/offline/driver-pos/types.ts), not invented ground
// truth. Offline (no network), the dialog's own existing error state
// ("Impossible de charger le detail...") is what actually surfaces to the
// user - no separate disable/networkState plumbing needed for this.
function toListItemFromOfflineSale(sale: OfflineSaleWithLines): SaleHistoryListItemDto {
  const number = sale.officialDisplayNumber ?? sale.localReference;
  return {
    id: sale.serverSaleId ?? sale.localId,
    invoiceNumber: number,
    displayNumber: number,
    posSessionId: null,
    status: "PAID",
    origin: "DRIVER",
    customer: null,
    driver: null,
    articleCount: sale.lines.reduce((sum, line) => sum + line.quantity, 0),
    totalTTC: sale.totalTTC,
    net: sale.totalTTC,
    paidAmount: sale.paidAmount,
    creditAmount: sale.creditAmount,
    paymentMethod: sale.paymentMethod,
    createdByUserName: "",
    createdAt: sale.soldAt,
    updatedAt: sale.syncedAt ?? sale.soldAt,
  };
}

/**
 * ÉTAPE 25 - "1. AUTH/UTILISATEUR": this component only ever reads
 * `organizationId`/`driverId` off the session (see the offline-sales effect
 * below) - narrowed here the same way DriverPosCurrentUser already was for
 * DriverPosView. The live useAuth() CurrentUser is a structural superset
 * (both fields nullable there too), so the web path is unaffected.
 */
export type DriverSalesCurrentUser = {
  organizationId: string | null;
  driverId: string | null;
};

async function defaultFetchCustomers(): Promise<CustomerDto[]> {
  try {
    const response = await fetch("/api/driver/customers", { cache: "no-store" });
    if (!response.ok) return [];
    const payload = (await response.json()) as { customers?: CustomerDto[] };
    return payload.customers ?? [];
  } catch {
    return [];
  }
}

export function DriverSalesView({
  data,
  currentUser,
  identity,
  fetchCustomers,
  fetchSaleDetail,
  fetchOfflineSales,
}: {
  data: DriverTodaySalesDto;
  /** ÉTAPE 25 - "1. AUTH/UTILISATEUR": omitted (every existing web call
   *  site) -> the live useAuth() session, byte-for-byte as before this prop
   *  existed. The shell injects its own already-hydrated
   *  {organizationId, driverId} instead of relying on this hook's own
   *  cookie-session fetch. `null` is a meaningful, real value (no session
   *  yet) - never treated the same as omitted, same reasoning as
   *  DriverPosView's own `currentUser` prop. */
  currentUser?: DriverSalesCurrentUser | null;
  /** ÉTAPE 25 - "2. COMPANY IDENTITY": same principle for
   *  useCompanyIdentity() - see DriverPosView's own `identity` prop. */
  identity?: CompanyIdentity | null;
  /** ÉTAPE 25 - "3. CUSTOMER LOADER": omitted -> defaultFetchCustomers
   *  (byte-for-byte today's relative fetch). The shell supplies a
   *  Bearer-authenticated fetch online, or getCachedCustomers() offline -
   *  never a second customer cache. */
  fetchCustomers?: () => Promise<CustomerDto[]>;
  /** ÉTAPE 25 - "4./9. DÉTAIL D'UNE VENTE": forwarded as-is to
   *  InvoiceDetailDialog's own `fetchSale` prop - see that component's own
   *  doc comment. Omitted -> its default relative fetchBase behavior. */
  fetchSaleDetail?: (id: string) => Promise<InvoiceDetailFetchOutcome>;
  /** ÉTAPE 25 - "5. OFFLINE SALES LOADER": omitted (every existing web call
   *  site) -> the exact current behavior (getOfflineSales() filtered to
   *  PENDING_SYNC + today, see isToday above). When provided, this
   *  COMPLETELY REPLACES that internal fetch+filter - the caller decides
   *  exactly which local sales to merge in (e.g. the shell, offline, passes
   *  every status for the current business day - see ÉTAPE 25B/C/G's own
   *  doc comments in mobile/driver/src/lib/driver-sales-data-source.ts for
   *  why online vs offline need different filters to avoid ever double-
   *  counting a sale already present in `data.sales`). */
  fetchOfflineSales?: () => Promise<OfflineSaleWithLines[]>;
}) {
  const { day, sales, stats } = data;
  const liveIdentityResult = useCompanyIdentity();
  // Rules of Hooks: called unconditionally on every render, exactly as
  // before this step - only WHICH value ends up used depends on the prop,
  // never whether the hook itself runs. Same pattern already established
  // for DriverPosView/DriverClientsView. AuthContext read directly (not
  // useAuth()) so a missing <AuthProvider> ancestor (the shell) safely
  // resolves to null instead of throwing - see DriverPosView's own ÉTAPE 11
  // doc comment for the identical discovered incompatibility.
  const liveCurrentUser = React.useContext(AuthContext)?.currentUser ?? null;
  const resolvedCurrentUser: DriverSalesCurrentUser | null =
    currentUser !== undefined
      ? currentUser
      : liveCurrentUser
        ? { organizationId: liveCurrentUser.organizationId, driverId: liveCurrentUser.driverId ?? null }
        : null;
  const resolvedIdentity = identity !== undefined ? identity : liveIdentityResult.identity;
  const organizationId = resolvedCurrentUser?.organizationId ?? null;
  const driverId = resolvedCurrentUser?.driverId ?? null;

  const [selectedSale, setSelectedSale] = React.useState<SaleHistoryListItemDto | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [sharingSaleId, setSharingSaleId] = React.useState<string | null>(null);

  // WhatsApp sharing only - SaleDto.customer never carries a phone (see
  // saleInclude in lib/server/sales-shared.ts), so it's resolved here from
  // the driver's own customer list (GET /api/driver/customers, already used
  // elsewhere). Also doubles as the name lookup for offline rows below (an
  // OfflineSaleWithLines only carries customerId, never a name snapshot).
  // No new API, no change to how sales themselves are fetched.
  const [customerById, setCustomerById] = React.useState<Map<string, CustomerDto>>(new Map());
  React.useEffect(() => {
    let active = true;
    const load = fetchCustomers ?? defaultFetchCustomers;
    load()
      .then((customers) => {
        if (!active) return;
        setCustomerById(new Map(customers.map((customer) => [customer.id, customer])));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [fetchCustomers]);

  // Phase 3 - "14. MES VENTES": today's still-local sales, read straight
  // from SQLite (see this task's own "TEST C" - they must still be here
  // after closing and reopening this screen without closing the app).
  // Never touches `sales`/`stats` above, which stay exactly what the
  // server returned.
  const [offlineSales, setOfflineSales] = React.useState<OfflineSaleWithLines[]>([]);
  React.useEffect(() => {
    let active = true;
    if (fetchOfflineSales) {
      fetchOfflineSales()
        .then((allSales) => {
          if (active) setOfflineSales(allSales);
        })
        .catch(() => {});
      return () => {
        active = false;
      };
    }
    if (!organizationId || !driverId) return;
    getOfflineSales({ organizationId, driverId })
      .then((allSales) => {
        if (!active) return;
        setOfflineSales(
          allSales.filter((sale) => sale.syncStatus === "PENDING_SYNC" && isToday(sale.createdAtLocal)),
        );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [organizationId, driverId, fetchOfflineSales]);

  const rows = React.useMemo<DisplayRow[]>(() => {
    const serverRows: DisplayRow[] = sales.map((sale) => ({ kind: "server", sale }));
    const offlineRows: DisplayRow[] = offlineSales.map((sale) => ({ kind: "offline", sale }));
    return [...serverRows, ...offlineRows].sort((a, b) => {
      const timeOf = (row: DisplayRow) =>
        new Date(row.kind === "server" ? row.sale.createdAt : row.sale.createdAtLocal).getTime();
      return timeOf(b) - timeOf(a);
    });
  }, [sales, offlineSales]);

  async function shareOnWhatsApp(sale: SaleDto) {
    if (sale.status === "DRAFT" || sale.status === "CANCELLED") return;
    setSharingSaleId(sale.id);
    try {
      const result = await shareInvoicePdf({
        sale,
        identity: resolvedIdentity,
        customerPhone: sale.customer ? customerById.get(sale.customer.id)?.phone ?? null : null,
      });
      if (result.method === "download") {
        toast.success("Facture PDF téléchargée. Joignez-la dans WhatsApp.");
      } else {
        toast.success("Facture PDF prête à être partagée.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(error instanceof Error ? error.message : "Impossible de générer la facture PDF.");
    } finally {
      setSharingSaleId(null);
    }
  }

  function openDetail(sale: SaleDto) {
    setSelectedSale(toListItem(sale));
    setDetailOpen(true);
  }

  // ÉTAPE 25I - only a SYNCED sale has a real serverSaleId to fetch by - a
  // still-local PENDING_SYNC/SYNCING/SYNC_ERROR/REQUIRES_REVIEW one never
  // opens a detail dialog (nothing server-side exists yet to show), exactly
  // like today's OfflineSaleRow already never did.
  function openOfflineSaleDetail(sale: OfflineSaleWithLines) {
    if (!sale.serverSaleId) return;
    setSelectedSale(toListItemFromOfflineSale(sale));
    setDetailOpen(true);
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-heading text-xl font-semibold text-foreground sm:text-2xl">
          Mes ventes du jour
        </h1>
        <p className="text-sm capitalize text-muted-foreground" suppressHydrationWarning>
          {formatDayLong(day)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Ventes" value={String(stats.count)} />
        <StatCard label="Total TTC" value={formatCurrency(stats.totalTTC)} />
        <StatCard label="Encaissé" value={formatCurrency(stats.paidAmount)} tone="positive" />
        <StatCard label="Crédit" value={formatCurrency(stats.creditAmount)} tone="warning" />
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Factures du jour</h2>

        {rows.length === 0 ? (
          <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
            <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
              <Receipt aria-hidden="true" className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Aucune vente aujourd&apos;hui.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {rows.map((row) =>
              row.kind === "offline" ? (
                <OfflineSaleRow
                  key={row.sale.localId}
                  sale={row.sale}
                  customerName={
                    row.sale.customerId
                      ? customerById.get(row.sale.customerId)?.name ?? "Client comptoir"
                      : "Client comptoir"
                  }
                  onOpenDetail={row.sale.serverSaleId ? () => openOfflineSaleDetail(row.sale) : undefined}
                />
              ) : (
              // A <div role="button"> here, not a real <button> - it wraps
              // the WhatsApp <Button> below, and HTML forbids nesting an
              // interactive control inside another one (a <button> inside a
              // <button> is a hydration error). tabIndex + onKeyDown restore
              // the same keyboard activation a native button gets for free.
              <div
                key={row.sale.id}
                role="button"
                tabIndex={0}
                onClick={() => openDetail(row.sale)}
                onKeyDown={(event) => {
                  // Ignore Enter/Space bubbling up from the nested WhatsApp
                  // button - only the row itself being focused should open
                  // the detail dialog.
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openDetail(row.sale);
                  }
                }}
                className="w-full cursor-pointer rounded-2xl border border-border bg-card p-3 text-left transition hover:border-emerald-200 hover:shadow-[0_6px_18px_rgba(16,185,129,0.08)]"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold text-foreground tabular-nums">
                    {row.sale.displayNumber}
                  </span>
                  <span className="shrink-0 font-semibold text-foreground tabular-nums">
                    {formatCurrency(row.sale.totalTTC)}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {row.sale.customer?.name ?? "Client comptoir"}
                </p>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {formatTime(row.sale.createdAt)}
                    {" · "}
                    {PAYMENT_LABELS[row.sale.paymentMethod] ?? row.sale.paymentMethod}
                  </p>
                  <div className="flex shrink-0 items-center gap-1">
                    {row.sale.tour?.code ? (
                      <Badge
                        variant="outline"
                        className="px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
                      >
                        {row.sale.tour.code}
                      </Badge>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={
                        row.sale.status === "DRAFT" ||
                        row.sale.status === "CANCELLED" ||
                        sharingSaleId === row.sale.id
                      }
                      aria-label={`Envoyer la facture ${row.sale.displayNumber} par WhatsApp`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void shareOnWhatsApp(row.sale);
                      }}
                      className="h-7 w-7 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                    >
                      {sharingSaleId === row.sale.id ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <MessageCircle className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
              ),
            )}
          </div>
        )}
      </div>

      <InvoiceDetailDialog
        listItem={selectedSale}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        fetchBase="/api/driver/sales"
        fetchSale={fetchSaleDetail}
      />
    </div>
  );
}

// Phase 3 - "14. MES VENTES": a still-local offline sale - no server id
// (or, once SYNCED, a real one - see onOpenDetail). Never offers WhatsApp
// sharing (see "17. WHATSAPP OFFLINE" / ÉTAPE 25J - the official PDF needs
// the FULL SaleDto, which this row never has locally, only after opening
// the detail dialog fetches it) - conserving today's exact restriction
// rather than inventing a fetch-then-share flow.
function OfflineSaleRow({
  sale,
  customerName,
  onOpenDetail,
}: {
  sale: OfflineSaleWithLines;
  customerName: string;
  /** ÉTAPE 25G/I - only ever set for a SYNCED sale with a real
   *  serverSaleId - see DriverSalesView's own openOfflineSaleDetail. */
  onOpenDetail?: () => void;
}) {
  const displayNumber = sale.officialDisplayNumber ?? sale.localReference;
  const statusLabel = OFFLINE_STATUS_LABEL[sale.syncStatus as Exclude<SyncStatus, "LOCAL_DRAFT">] ?? sale.syncStatus;
  const statusIcon = sale.syncStatus === "SYNCED" ? "✓ " : sale.syncStatus === "PENDING_SYNC" ? "⏳ " : "";

  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="font-semibold text-foreground tabular-nums">{displayNumber}</span>
        <span className="shrink-0 font-semibold text-foreground tabular-nums">
          {formatCurrency(sale.totalTTC)}
        </span>
      </div>
      <p className="mt-0.5 truncate text-sm text-muted-foreground">{customerName}</p>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {formatTime(sale.soldAt)}
          {" · "}
          {PAYMENT_LABELS[sale.paymentMethod] ?? sale.paymentMethod}
        </p>
        <Badge
          variant="outline"
          className={
            sale.syncStatus === "SYNCED"
              ? "border-emerald-200 bg-emerald-50 px-1.5 py-0 text-[10px] font-normal text-emerald-800"
              : sale.syncStatus === "SYNC_ERROR" || sale.syncStatus === "REQUIRES_REVIEW"
                ? "border-red-200 bg-red-50 px-1.5 py-0 text-[10px] font-normal text-red-700"
                : "border-amber-300 bg-amber-100 px-1.5 py-0 text-[10px] font-normal text-amber-800"
          }
        >
          {statusIcon}
          {statusLabel}
        </Badge>
      </div>
    </>
  );

  if (!onOpenDetail) {
    return (
      <div className="w-full rounded-2xl border border-dashed border-amber-200 bg-amber-50/40 p-3 text-left">
        {content}
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenDetail}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenDetail();
        }
      }}
      className="w-full cursor-pointer rounded-2xl border border-border bg-card p-3 text-left transition hover:border-emerald-200 hover:shadow-[0_6px_18px_rgba(16,185,129,0.08)]"
    >
      {content}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "positive" | "warning";
}) {
  return (
    <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
      <CardContent className="p-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className={
            "mt-1 text-lg font-semibold tabular-nums " +
            (tone === "positive"
              ? "text-emerald-700"
              : tone === "warning"
                ? "text-amber-600"
                : "text-foreground")
          }
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
