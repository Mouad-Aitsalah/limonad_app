"use client";

import * as React from "react";
import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CustomerOrderDetailDialog } from "@/components/customer-orders/customer-order-detail-dialog";
import { CustomerOrderStatusBadge } from "@/components/customer-orders/customer-order-status-badge";
import { useCustomerOrderActions } from "@/components/customer-orders/use-customer-order-actions";
import { canOpenInPos, canStaffTransition, type CustomerOrderStatusValue } from "@/lib/client-portal-rules";
import { cn, formatCurrency } from "@/lib/utils";
import type { CustomerOrderDetailDto, CustomerOrderListItemDto, CustomerOrdersPageDto } from "@/types/customer-order-dto";

const FILTERS: Array<{ value: CustomerOrderStatusValue | null; label: string }> = [
  { value: "SUBMITTED", label: "À traiter" },
  { value: "ACCEPTED", label: "Acceptées" },
  { value: "CONVERTED", label: "Facturées" },
  { value: "REJECTED", label: "Refusées" },
  { value: null, label: "Toutes" },
];

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("fr-MA", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

/**
 * Internal "Commandes en ligne": the orders sent from the Espace Client.
 * Accept / reject only change the status; "Ouvrir dans le POS" pre-fills the
 * POS cart and the invoice is created by the POS's normal validation.
 */
export function CustomerOrdersView({ initialPage }: { initialPage: CustomerOrdersPageDto }) {
  const [status, setStatus] = React.useState<CustomerOrderStatusValue | null>("SUBMITTED");
  const [items, setItems] = React.useState<CustomerOrderListItemDto[]>(initialPage.items);
  const [nextCursor, setNextCursor] = React.useState<string | null>(initialPage.nextCursor);
  const [loading, setLoading] = React.useState(false);
  const [detail, setDetail] = React.useState<CustomerOrderDetailDto | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);

  const load = React.useCallback(async (nextStatus: CustomerOrderStatusValue | null, cursor: string | null) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (nextStatus) params.set("status", nextStatus);
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/customer-orders?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as CustomerOrdersPageDto & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Impossible de charger les commandes.");
      setItems((current) => (cursor ? [...current, ...payload.items] : payload.items));
      setNextCursor(payload.nextCursor);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible de charger les commandes.");
    } finally {
      setLoading(false);
    }
  }, []);

  const onChanged = React.useCallback(
    (order: CustomerOrderDetailDto) => {
      setDetail(order);
      setItems((current) =>
        status && order.status !== status
          ? current.filter((item) => item.id !== order.id)
          : current.map((item) => (item.id === order.id ? order : item)),
      );
    },
    [status],
  );
  const { busyId, accept, reject } = useCustomerOrderActions(onChanged);

  async function openDetail(orderId: string) {
    setDetailLoading(true);
    setDetail(null);
    try {
      const response = await fetch(`/api/customer-orders/${encodeURIComponent(orderId)}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as { order?: CustomerOrderDetailDto; message?: string };
      if (!response.ok || !payload.order) throw new Error(payload.message ?? "Commande introuvable.");
      setDetail(payload.order);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Commande introuvable.");
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((filter) => (
          <Button
            key={filter.label}
            type="button"
            size="sm"
            variant={status === filter.value ? "default" : "outline"}
            onClick={() => {
              setStatus(filter.value);
              void load(filter.value, null);
            }}
          >
            {filter.label}
          </Button>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Commande</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Client</TableHead>
              <TableHead className="text-right">Articles</TableHead>
              <TableHead className="text-right">Total estimé</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  {loading ? "Chargement…" : "Aucune commande en ligne."}
                </TableCell>
              </TableRow>
            ) : (
              items.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-medium">{order.orderNumber}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDateTime(order.createdAt)}</TableCell>
                  <TableCell>
                    {order.customer.name}
                    <span className="block text-xs text-muted-foreground">
                      {order.customer.displayCode}
                      {order.contactPhone ? ` · ${order.contactPhone}` : ""}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{order.itemCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(order.totalTTC)}</TableCell>
                  <TableCell>
                    <CustomerOrderStatusBadge status={order.status} invoicePending={order.invoicePending} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1.5">
                      <Button type="button" size="sm" variant="ghost" onClick={() => void openDetail(order.id)}>
                        Voir
                      </Button>
                      {canStaffTransition(order.status, "ACCEPTED") ? (
                        <Button type="button" size="sm" onClick={() => void accept(order.id)} disabled={busyId === order.id}>
                          Accepter
                        </Button>
                      ) : null}
                      {canOpenInPos(order.status) ? (
                        <Link
                          href={`/pos?customerOrder=${encodeURIComponent(order.id)}`}
                          className={cn(buttonVariants({ size: "sm" }), "bg-emerald-600 text-white hover:bg-emerald-700")}
                        >
                          <ShoppingCart aria-hidden="true" className="h-3.5 w-3.5" />
                          Ouvrir dans le POS
                        </Link>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {nextCursor ? (
        <div className="flex justify-center">
          <Button type="button" variant="outline" onClick={() => void load(status, nextCursor)} disabled={loading}>
            Voir plus
          </Button>
        </div>
      ) : null}

      <CustomerOrderDetailDialog
        order={detail}
        loading={detailLoading}
        busy={detail ? busyId === detail.id : false}
        onClose={() => setDetail(null)}
        onAccept={(orderId) => void accept(orderId)}
        onReject={(orderId, reason) => void reject(orderId, reason)}
      />
    </div>
  );
}
