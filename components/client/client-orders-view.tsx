"use client";

import Link from "next/link";
import { ClipboardList, Package } from "lucide-react";

import { ClientHeader } from "@/components/client/client-header";
import { CustomerOrderStatusBadge } from "@/components/customer-orders/customer-order-status-badge";
import type { ClientOrderSummaryDto, ClientOrganizationIdentityDto, ClientSessionDto } from "@/types/client-portal";

type ClientOrdersViewProps = {
  client: ClientSessionDto;
  organization: ClientOrganizationIdentityDto;
  orders: ClientOrderSummaryDto[];
};

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("fr-MA", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

/** « Mes commandes »: number, date, article count and status of the customer's orders - no amount. */
export function ClientOrdersView({ client, organization, orders }: ClientOrdersViewProps) {
  return (
    <div className="min-h-dvh bg-slate-50">
      <div className="sticky top-0 z-20 bg-white shadow-[0_4px_16px_rgba(15,23,42,0.05)]">
        <ClientHeader client={client} organization={organization} active="orders" />
      </div>

      <main className="mx-auto max-w-2xl space-y-3 px-3 py-4 sm:px-6 sm:py-6">
        <h1 className="px-1 font-heading text-lg font-semibold text-foreground">Mes commandes</h1>

        {orders.length === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border bg-white px-6 py-12 text-center">
            <ClipboardList aria-hidden="true" className="h-10 w-10 text-emerald-700" />
            <p className="text-sm text-muted-foreground">Vous n&apos;avez encore envoyé aucune commande.</p>
            <Link
              href="/client/catalog"
              className="flex h-12 items-center justify-center rounded-2xl bg-emerald-600 px-6 text-[15px] font-semibold text-white hover:bg-emerald-700"
            >
              Voir le catalogue
            </Link>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {orders.map((order) => (
              <li
                key={order.id}
                className="flex items-center gap-3 rounded-2xl border border-border bg-white p-3.5 shadow-[0_6px_18px_rgba(15,23,42,0.04)]"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                  <Package aria-hidden="true" className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-foreground">{order.orderNumber}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(order.createdAt)} · {order.itemCount} article{order.itemCount > 1 ? "s" : ""}
                  </p>
                </div>
                <CustomerOrderStatusBadge status={order.status} invoicePending={order.invoicePending} />
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
