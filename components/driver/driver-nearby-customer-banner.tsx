"use client";

import { MapPin, ShoppingCart, Store, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useDriverRuntime } from "@/hooks/use-driver-runtime";
import { cn } from "@/lib/utils";

export function DriverNearbyCustomerBanner({
  floating = false,
}: {
  floating?: boolean;
}) {
  const router = useRouter();
  const { nearbyCustomer, dismissNearbyCustomer } = useDriverRuntime();

  if (!nearbyCustomer) {
    return null;
  }

  const { customer, distanceMeters } = nearbyCustomer;

  return (
    <div
      className={cn(
        floating
          ? "pointer-events-none fixed top-[4.4rem] right-3 left-3 z-[760] lg:right-5 lg:left-[306px]"
          : "px-4 pt-3 sm:px-5",
      )}
    >
      <div className="pointer-events-auto rounded-[26px] border border-emerald-200/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(236,253,245,0.98))] p-3 shadow-[0_18px_38px_rgba(5,150,105,0.16)] backdrop-blur">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
              <Store className="h-5 w-5" />
            </div>

            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700">
                Client proche
              </p>
              <p className="mt-1 truncate text-sm font-semibold text-slate-900 sm:text-base">
                {customer.name}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600 sm:text-sm">
                <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-1 font-medium text-slate-700">
                  <MapPin className="h-3.5 w-3.5 text-emerald-700" />
                  {formatDistance(distanceMeters)}
                </span>
                {customer.city ? <span>{customer.city}</span> : null}
                {customer.address ? (
                  <span className="truncate">{customer.address}</span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 lg:justify-end">
            <Button
              type="button"
              size="sm"
              className="rounded-xl bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={() =>
                router.push(`/driver/pos?customerId=${encodeURIComponent(customer.id)}`)
              }
            >
              <ShoppingCart className="h-4 w-4" />
              Faire une vente
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-xl"
              onClick={() =>
                router.push(`/driver/clients?customerId=${encodeURIComponent(customer.id)}`)
              }
            >
              Voir client
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="rounded-xl text-slate-600 hover:text-slate-900"
              onClick={dismissNearbyCustomer}
            >
              <X className="h-4 w-4" />
              Ignorer
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatDistance(value: number) {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)} km`;
  }

  return `${Math.round(value)} m`;
}
