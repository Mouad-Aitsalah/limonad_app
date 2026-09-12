"use client";

import * as React from "react";
import { LoaderCircle, MessageCircle, Receipt } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InvoiceDetailDialog } from "@/components/ventes/invoice-detail-dialog";
import { useCompanyIdentity } from "@/hooks/use-company-identity";
import { shareInvoicePdf } from "@/lib/share-invoice";
import { formatCurrency } from "@/lib/utils";
import type {
  CustomerDto,
  DriverTodaySalesDto,
  SaleDto,
  SaleHistoryListItemDto,
} from "@/types/operations-dto";

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

export function DriverSalesView({ data }: { data: DriverTodaySalesDto }) {
  const { day, sales, stats } = data;
  const { identity } = useCompanyIdentity();
  const [selectedSale, setSelectedSale] = React.useState<SaleHistoryListItemDto | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [sharingSaleId, setSharingSaleId] = React.useState<string | null>(null);

  // WhatsApp sharing only - SaleDto.customer never carries a phone (see
  // saleInclude in lib/server/sales-shared.ts), so it's resolved here from
  // the driver's own customer list (GET /api/driver/customers, already used
  // elsewhere). No new API, no change to how sales themselves are fetched.
  const [phoneByCustomerId, setPhoneByCustomerId] = React.useState<Map<string, string | null>>(
    new Map(),
  );
  React.useEffect(() => {
    let active = true;
    fetch("/api/driver/customers", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { customers: [] }))
      .then((payload: { customers?: CustomerDto[] }) => {
        if (!active) return;
        setPhoneByCustomerId(
          new Map((payload.customers ?? []).map((customer) => [customer.id, customer.phone])),
        );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  async function shareOnWhatsApp(sale: SaleDto) {
    if (sale.status === "DRAFT" || sale.status === "CANCELLED") return;
    setSharingSaleId(sale.id);
    try {
      const result = await shareInvoicePdf({
        sale,
        identity,
        customerPhone: sale.customer ? phoneByCustomerId.get(sale.customer.id) ?? null : null,
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

        {sales.length === 0 ? (
          <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
            <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
              <Receipt aria-hidden="true" className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Aucune vente aujourd&apos;hui.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {sales.map((sale) => (
              // A <div role="button"> here, not a real <button> - it wraps
              // the WhatsApp <Button> below, and HTML forbids nesting an
              // interactive control inside another one (a <button> inside a
              // <button> is a hydration error). tabIndex + onKeyDown restore
              // the same keyboard activation a native button gets for free.
              <div
                key={sale.id}
                role="button"
                tabIndex={0}
                onClick={() => openDetail(sale)}
                onKeyDown={(event) => {
                  // Ignore Enter/Space bubbling up from the nested WhatsApp
                  // button - only the row itself being focused should open
                  // the detail dialog.
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openDetail(sale);
                  }
                }}
                className="w-full cursor-pointer rounded-2xl border border-border bg-card p-3 text-left transition hover:border-emerald-200 hover:shadow-[0_6px_18px_rgba(16,185,129,0.08)]"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold text-foreground tabular-nums">
                    {sale.displayNumber}
                  </span>
                  <span className="shrink-0 font-semibold text-foreground tabular-nums">
                    {formatCurrency(sale.totalTTC)}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {sale.customer?.name ?? "Client comptoir"}
                </p>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {formatTime(sale.createdAt)}
                    {" · "}
                    {PAYMENT_LABELS[sale.paymentMethod] ?? sale.paymentMethod}
                  </p>
                  <div className="flex shrink-0 items-center gap-1">
                    {sale.tour?.code ? (
                      <Badge
                        variant="outline"
                        className="px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
                      >
                        {sale.tour.code}
                      </Badge>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={
                        sale.status === "DRAFT" ||
                        sale.status === "CANCELLED" ||
                        sharingSaleId === sale.id
                      }
                      aria-label={`Envoyer la facture ${sale.displayNumber} par WhatsApp`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void shareOnWhatsApp(sale);
                      }}
                      className="h-7 w-7 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                    >
                      {sharingSaleId === sale.id ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <MessageCircle className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <InvoiceDetailDialog
        listItem={selectedSale}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        fetchBase="/api/driver/sales"
      />
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
