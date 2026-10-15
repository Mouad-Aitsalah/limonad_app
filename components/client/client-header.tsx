"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardList, LogOut, ShoppingCart } from "lucide-react";

import { cartCounts, cartStorageKey, useClientCart } from "@/lib/client-cart-store";
import { cn } from "@/lib/utils";
import type { ClientOrganizationIdentityDto, ClientSessionDto } from "@/types/client-portal";

type ClientHeaderProps = {
  client: ClientSessionDto;
  organization: ClientOrganizationIdentityDto;
  /** The page shown, so its own shortcut is highlighted. */
  active: "catalog" | "cart" | "orders";
  /** Catalogue: the cart opens as a panel over the list (keeps the position). Elsewhere: the cart page. */
  onOpenCart?: () => void;
};

const iconButtonClass =
  "relative flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition-colors hover:bg-emerald-50 hover:text-emerald-700 focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus-visible:outline-none";

/**
 * Compact header of the Espace Client (56 px): the organisation (back to the catalogue), the customer, and
 * three shortcuts - my orders, the cart with its live article count (same localStorage store as the cart),
 * and logout.
 */
export function ClientHeader({ client, organization, active, onOpenCart }: ClientHeaderProps) {
  const router = useRouter();
  const { cart } = useClientCart(cartStorageKey(client.organizationId, client.customerId));
  const { itemCount } = cartCounts(cart);
  const organizationName = organization.tradeName?.trim() || organization.name;

  async function handleLogout() {
    await fetch("/api/client/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/client/login");
  }

  const cartBadge =
    itemCount > 0 ? (
      <span
        data-testid="client-cart-count"
        className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-600 px-1 text-[11px] font-bold text-white tabular-nums ring-2 ring-white"
      >
        {itemCount > 99 ? "99+" : itemCount}
      </span>
    ) : null;
  const cartLabel = `Mon panier, ${itemCount} article${itemCount > 1 ? "s" : ""}`;

  return (
    <header className="border-b border-emerald-100 bg-white">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-3 sm:px-6">
        <Link href="/client/catalog" className="flex min-w-0 items-center gap-2.5" aria-label={`${organizationName} - catalogue`}>
          {organization.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={organization.logoUrl} alt="" className="h-9 w-9 shrink-0 rounded-xl object-contain" />
          ) : (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-sm font-bold text-white">
              {organizationName.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="min-w-0 leading-tight">
            <span className="block truncate font-heading text-[15px] font-semibold text-foreground">{organizationName}</span>
            <span className="block truncate text-xs text-muted-foreground">{client.customerName}</span>
          </span>
        </Link>

        <nav className="flex shrink-0 items-center gap-0.5" aria-label="Espace client">
          <Link
            href="/client/orders"
            className={cn(iconButtonClass, active === "orders" && "bg-emerald-50 text-emerald-700")}
            aria-label="Mes commandes"
            aria-current={active === "orders" ? "page" : undefined}
          >
            <ClipboardList aria-hidden="true" className="h-5 w-5" />
          </Link>
          {onOpenCart ? (
            <button type="button" onClick={onOpenCart} className={iconButtonClass} aria-label={cartLabel}>
              <ShoppingCart aria-hidden="true" className="h-5 w-5" />
              {cartBadge}
            </button>
          ) : (
            <Link
              href="/client/cart"
              className={cn(iconButtonClass, active === "cart" && "bg-emerald-50 text-emerald-700")}
              aria-label={cartLabel}
              aria-current={active === "cart" ? "page" : undefined}
            >
              <ShoppingCart aria-hidden="true" className="h-5 w-5" />
              {cartBadge}
            </Link>
          )}
          <button type="button" onClick={handleLogout} className={iconButtonClass} aria-label="Se déconnecter">
            <LogOut aria-hidden="true" className="h-5 w-5" />
          </button>
        </nav>
      </div>
    </header>
  );
}
