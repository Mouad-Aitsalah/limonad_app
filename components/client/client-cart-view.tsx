"use client";

import { useRouter } from "next/navigation";

import { ClientCartCheckout } from "@/components/client/client-cart-checkout";
import { ClientHeader } from "@/components/client/client-header";
import type { ClientOrganizationIdentityDto, ClientSessionDto } from "@/types/client-portal";

type ClientCartViewProps = {
  client: ClientSessionDto;
  organization: ClientOrganizationIdentityDto;
};

/** /client/cart: the same cart -> confirmation path as the catalogue's cart panel (ClientCartCheckout). */
export function ClientCartView({ client, organization }: ClientCartViewProps) {
  const router = useRouter();
  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <div className="sticky top-0 z-20 bg-white shadow-[0_4px_16px_rgba(15,23,42,0.05)]">
        <ClientHeader client={client} organization={organization} active="cart" />
      </div>
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col sm:py-6">
        <div className="flex flex-1 flex-col bg-white sm:rounded-[28px] sm:border sm:border-border sm:shadow-[0_10px_25px_rgba(15,23,42,0.05)]">
          <h1 className="px-4 pt-4 font-heading text-lg font-semibold text-foreground sm:px-5 sm:pt-5">Mon panier</h1>
          <ClientCartCheckout client={client} onContinueShopping={() => router.push("/client/catalog")} />
        </div>
      </main>
    </div>
  );
}
