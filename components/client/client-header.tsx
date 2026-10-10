"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, ShoppingCart } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cartStorageKey, useClientCart } from "@/lib/client-cart-store";
import { cn } from "@/lib/utils";
import type { ClientOrganizationIdentityDto, ClientSessionDto } from "@/types/client-portal";

type ClientHeaderProps = {
  client: ClientSessionDto;
  organization: ClientOrganizationIdentityDto;
  /** Subtitle under the organisation name, e.g. "Espace Client · Catalogue". */
  subtitle: string;
};

/**
 * Shared header of the client platform's pages (catalog, cart): organisation
 * identity, a cart link showing the live article count (read from the same
 * localStorage-backed store as the cart page) and logout.
 */
export function ClientHeader({ client, organization, subtitle }: ClientHeaderProps) {
  const router = useRouter();
  const { cart } = useClientCart(cartStorageKey(client.organizationId, client.email));
  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const organizationName = organization.tradeName?.trim() || organization.name;

  async function handleLogout() {
    await fetch("/api/client/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/client/login");
  }

  return (
    <header className="sticky top-0 z-20 border-b border-emerald-100 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          {organization.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={organization.logoUrl} alt={organizationName} className="h-10 w-10 rounded-xl object-contain" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-sm font-bold text-white">
              {organizationName.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate font-heading text-lg font-semibold text-foreground">{organizationName}</p>
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/client/cart" className={cn(buttonVariants({ variant: "outline" }), "relative")}>
            <ShoppingCart aria-hidden="true" className="h-4 w-4" />
            <span className="hidden sm:inline">Panier</span>
            {cartCount > 0 ? <Badge className="ml-1 bg-emerald-600 text-white">{cartCount}</Badge> : null}
            <span className="sr-only">{cartCount} article{cartCount > 1 ? "s" : ""} dans le panier</span>
          </Link>
          <Button type="button" variant="ghost" size="icon" onClick={handleLogout} aria-label="Se déconnecter">
            <LogOut aria-hidden="true" className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
