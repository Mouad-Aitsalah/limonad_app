"use client";

import * as React from "react";
import { MessageCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCompanyIdentity } from "@/hooks/use-company-identity";
import { formatCurrency } from "@/lib/utils";
import {
  buildWhatsAppInvoiceMessage,
  buildWhatsAppUrl,
  normalizeWhatsAppPhone,
} from "@/lib/whatsapp-invoice";
import type { CustomerDto, DriverTourSalesSummaryDto, SaleDto } from "@/types/operations-dto";

export function DriverSalesView({
  groups,
}: {
  groups: DriverTourSalesSummaryDto[];
}) {
  const [selectedTourId, setSelectedTourId] = React.useState(groups[0]?.tourId ?? "");
  const selectedGroup = groups.find((group) => group.tourId === selectedTourId) ?? groups[0];
  const { identity } = useCompanyIdentity();

  // WhatsApp sharing only: SaleDto.customer never carries a phone (see
  // saleInclude in lib/server/sales-shared.ts), so it's resolved here from
  // the driver's own customer list (GET /api/driver/customers, already used
  // elsewhere - see getCustomersForCurrentDriver) by id. No new API, no
  // change to how sales themselves are fetched or displayed.
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

  function shareOnWhatsApp(sale: SaleDto) {
    const phone = normalizeWhatsAppPhone(
      sale.customer ? phoneByCustomerId.get(sale.customer.id) ?? null : null,
    );
    const message = buildWhatsAppInvoiceMessage(sale, identity?.tradeName ?? identity?.name);
    window.open(buildWhatsAppUrl(phone, message), "_blank", "noopener,noreferrer");
  }
  const totals = React.useMemo(
    () => ({
      salesCount: groups.reduce((sum, group) => sum + group.salesCount, 0),
      totalTTC: groups.reduce((sum, group) => sum + group.totalTTC, 0),
      paidAmount: groups.reduce((sum, group) => sum + group.paidAmount, 0),
      creditAmount: groups.reduce((sum, group) => sum + group.creditAmount, 0),
    }),
    [groups],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Mes ventes
        </h1>
        <p className="text-sm text-muted-foreground">
          Ventes PostgreSQL regroupees par tournee.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Metric label="Ventes" value={String(totals.salesCount)} />
        <Metric label="Total TTC" value={formatCurrency(totals.totalTTC)} />
        <Metric label="Encaisse" value={formatCurrency(totals.paidAmount)} />
        <Metric label="Credit" value={formatCurrency(totals.creditAmount)} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
        <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
          <CardContent className="space-y-3">
            {groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune vente.</p>
            ) : (
              groups.map((group) => (
                <button
                  key={group.tourId}
                  type="button"
                  onClick={() => setSelectedTourId(group.tourId)}
                  className="w-full rounded-2xl border border-border p-4 text-left transition hover:border-emerald-200"
                >
                  <p className="font-medium">{group.tourCode}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(group.date).toLocaleDateString("fr-FR")} - {group.truckCode}
                  </p>
                  <p className="mt-2 text-sm font-semibold">
                    {formatCurrency(group.totalTTC)}
                  </p>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
          <CardContent>
            {selectedGroup ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Facture</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead className="text-right">HT</TableHead>
                    <TableHead className="text-right">TVA</TableHead>
                    <TableHead className="text-right">TTC</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedGroup.sales.map((sale) => (
                    <TableRow key={sale.id}>
                      <TableCell>
                        <div className="font-medium">{sale.invoiceNumber}</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(sale.createdAt).toLocaleString("fr-FR")}
                        </div>
                      </TableCell>
                      <TableCell>{sale.customer?.name ?? "Client comptoir"}</TableCell>
                      <TableCell><Badge variant="secondary">{sale.status}</Badge></TableCell>
                      <TableCell className="text-right">{formatCurrency(sale.subtotalHT)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(sale.taxAmount)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(sale.totalTTC)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(sale.creditAmount)}</TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Envoyer la facture ${sale.displayNumber} par WhatsApp`}
                          disabled={sale.status === "DRAFT" || sale.status === "CANCELLED"}
                          onClick={() => shareOnWhatsApp(sale)}
                          className="text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                        >
                          <MessageCircle className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">Aucune vente selectionnee.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
      <CardContent>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-2 text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}
