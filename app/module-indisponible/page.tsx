import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LockKeyhole } from "lucide-react";

import { ModuleUnavailableActions } from "@/components/auth/module-unavailable-actions";
import { getDefaultRouteForRole } from "@/lib/auth/default-route";
import { findModule } from "@/lib/modules/registry";
import { getCurrentSessionUser } from "@/lib/server/auth";

export const metadata: Metadata = {
  title: "Module non disponible | COMDIS",
};

export const dynamic = "force-dynamic";

type ModuleUnavailablePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Where requireModulePage() sends a page of a module the SUPER_ADMIN disabled
 * for the organisation (any role, so it lives outside the dashboard and
 * driver layouts). It only explains and offers a way out: the first page
 * still available, or logging out. The module name comes from the registry;
 * an unknown value from the URL is simply not displayed.
 */
export default async function ModuleUnavailablePage({ searchParams }: ModuleUnavailablePageProps) {
  const user = await getCurrentSessionUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const moduleParam = typeof params.module === "string" ? params.module : "";
  const moduleDefinition = findModule(moduleParam);
  const home = getDefaultRouteForRole(user.role, user.disabledModules);
  const homeHref = home.startsWith("/module-indisponible") ? null : home;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/30 px-4 py-10">
      <div className="w-full max-w-md space-y-5 rounded-3xl border border-border/70 bg-card p-6 text-center shadow-[0_20px_50px_rgba(15,23,42,0.08)] sm:p-8">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
          <LockKeyhole aria-hidden="true" className="size-6" />
        </div>
        <div className="space-y-2">
          <h1 className="font-heading text-xl font-semibold text-foreground">Module non disponible</h1>
          <p className="text-sm text-muted-foreground">
            {moduleDefinition
              ? `Le module « ${moduleDefinition.label} » n'est pas activé pour votre organisation.`
              : "Ce module n'est pas activé pour votre organisation."}{" "}
            Pour y accéder, contactez l&apos;administrateur de la plateforme COMDIS.
          </p>
        </div>
        <ModuleUnavailableActions homeHref={homeHref} />
      </div>
    </main>
  );
}
