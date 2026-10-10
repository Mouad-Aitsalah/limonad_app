"use client";

import Link from "next/link";
import { ClipboardList } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { ClientHeader } from "@/components/client/client-header";
import { CustomerOrderStatusBadge } from "@/components/customer-orders/customer-order-status-badge";
import { cn, formatCurrency } from "@/lib/utils";
import type { ClientOrderSummaryDto, ClientOrganizationIdentityDto, ClientSessionDto } from "@/types/client-portal";

type ClientOrdersViewProps = {
  client: ClientSessionDto;
  organization: ClientOrganizationIdentityDto;
  orders: ClientOrderSummaryDto[];
};

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("fr-MA", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

export function ClientOrdersView({ client, organization, orders }: ClientOrdersViewProps) {
  return (
    <div className="min-h-screen bg-emerald-50/30">
      <ClientHeader client={client} organization={organization} subtitle="Espace Client · Mes commandes" />

      <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6">
        <h1 className="font-heading text-2xl font-semibold text-foreground">Mes commandes</h1>

        {orders.length === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border bg-white px-6 py-16 text-center">
            <ClipboardList aria-hidden="true" className="h-10 w-10 text-emerald-700" />
            <p className="text-sm text-muted-foreground">Vous n&apos;avez encore envoyé aucune commande.</p>
            <Link href="/client/catalog" className={cn(buttonVariants(), "bg-emerald-600 text-white hover:bg-emerald-700")}>
              Voir le catalogue
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {orders.map((order) => (
              <li
                key={order.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-white p-4 shadow-[0_10px_25px_rgba(15,23,42,0.05)]"
              >
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{order.orderNumber}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(order.createdAt)} · {order.itemCount} article{order.itemCount > 1 ? "s" : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-sm font-semibold tabular-nums">{formatCurrency(order.totalTTC)}</span>
                  <CustomerOrderStatusBadge status={order.status} invoicePending={order.invoicePending} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
