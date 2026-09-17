"use client";

import Link from "next/link";
import { ArrowUpRight, PackageCheck, Route, ShoppingCart, Users } from "lucide-react";

import { driverNavItems } from "@/components/driver/driver-nav-items";
import { DriverTruckCard } from "@/components/driver/driver-truck-card";
import { AppPageHeader } from "@/components/ui/app-page-header";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/ui/metric-card";
import type { TruckDto } from "@/types/operations-dto";

/**
 * PHASE 1 "RESTAURATION DU POS CHAUFFEUR" - ÉTAPE 19: the historical /driver
 * Accueil's own JSX, extracted verbatim from app/driver/page.tsx (still that
 * Server Component's only caller on the web) so the Android shell can render
 * the exact same screen instead of forking a new one - same pattern already
 * used for DriverPosView. `truck` is passed in explicitly since a Vite/
 * Capacitor screen has no Server Component of its own to call
 * getCurrentDriverTruck() from.
 *
 * `onNavigate`, omitted on the web (app/driver/page.tsx's only call site),
 * keeps today's exact <Link href> behavior. When supplied (the shell, which
 * has no Next router - see mobile/driver's own next-link.tsx shim doc
 * comment), each quick-link becomes a plain button instead, calling back
 * with the SAME href string the Link would have navigated to - the shell
 * maps that href to its own Screen union (see DriverHomeScreen.tsx).
 */
export function DriverHomeView({
  truck,
  onNavigate,
}: {
  truck: TruckDto | null;
  onNavigate?: (href: string) => void;
}) {
  const quickLinks = driverNavItems.filter((item) => item.href !== "/driver");
  const homeMetrics = [
    {
      eyebrow: "Stock",
      title: "Mon stock",
      value: "Camion",
      helper: "Verifier rapidement le stock disponible.",
      accent: "green" as const,
      icon: PackageCheck,
    },
    {
      eyebrow: "Ventes",
      title: "Mes ventes",
      value: "Journal",
      helper: "Suivre les ventes du jour et l'historique.",
      accent: "blue" as const,
      icon: ShoppingCart,
    },
    {
      eyebrow: "Tournee",
      title: "Ma tournee",
      value: "GPS",
      helper: "Piloter la tournee et les visites clients.",
      accent: "orange" as const,
      icon: Route,
    },
    {
      eyebrow: "Clients",
      title: "Mes clients",
      value: "Contacts",
      helper: "Retrouver rapidement les clients a livrer.",
      accent: "navy" as const,
      icon: Users,
    },
  ];

  return (
    <div className="space-y-6">
      <AppPageHeader
        eyebrow="Driver Space"
        title="Accueil chauffeur"
        description="Accedez rapidement au stock camion, aux ventes, a la tournee et aux clients depuis une interface mobile-first."
      />

      <DriverTruckCard truck={truck} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {homeMetrics.map((metric) => (
          <MetricCard
            key={metric.title}
            eyebrow={metric.eyebrow}
            title={metric.title}
            value={metric.value}
            helper={metric.helper}
            icon={metric.icon}
            accent={metric.accent}
          />
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {quickLinks.map((item) => {
          const Icon = item.icon;
          const card = (
            <Card className="transition duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_20px_36px_rgba(15,23,42,0.12)]">
              <CardContent className="flex items-center gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[20px] bg-[var(--surface-soft)] text-[var(--primary)]">
                  <Icon aria-hidden="true" className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-base">{item.label}</CardTitle>
                  <CardDescription>Acceder a cet ecran</CardDescription>
                </div>
                <ArrowUpRight className="ml-auto h-4 w-4 text-[var(--text-secondary)]" />
              </CardContent>
            </Card>
          );

          return onNavigate ? (
            <button
              key={item.href}
              type="button"
              onClick={() => onNavigate(item.href)}
              className="block w-full text-left"
            >
              {card}
            </button>
          ) : (
            <Link key={item.href} href={item.href}>
              {card}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
