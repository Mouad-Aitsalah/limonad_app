import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, PackageCheck, Route, ShoppingCart, Users } from "lucide-react";

import { driverNavItems } from "@/components/driver/driver-nav-items";
import { DriverTruckCard } from "@/components/driver/driver-truck-card";
import { AppPageHeader } from "@/components/ui/app-page-header";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/ui/metric-card";
import { AuthServiceError } from "@/lib/server/auth";
import { getCurrentDriverTruck } from "@/lib/server/drivers";

export const metadata: Metadata = {
  title: "Accueil",
};

export default async function DriverHomePage() {
  const truck = await loadDriverTruck();
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

          return (
            <Link key={item.href} href={item.href}>
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
            </Link>
          );
        })}
      </div>
    </div>
  );
}

async function loadDriverTruck() {
  try {
    return await getCurrentDriverTruck();
  } catch (error) {
    if (error instanceof AuthServiceError) {
      redirect(error.status === 401 ? "/login" : "/");
    }
    throw error;
  }
}
