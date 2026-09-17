import { ArrowLeft } from "lucide-react";

import { DriverPlaceholder } from "@/components/driver/driver-placeholder";
import type { DriverNavItem } from "@/components/driver/driver-nav-items";

/**
 * PHASE 1 "RESTAURATION DU POS CHAUFFEUR" - ÉTAPE 19 - "4. NAVIGATION
 * ANDROID": Mon stock/Mes ventes/Mes clients/Ma tournee are real, navigable
 * entries in the shell now (see navigation.ts's own Screen union) but their
 * historical screens (DriverStockView/DriverSalesView/DriverClientsView/
 * DriverTourView) are not ported to this shell yet - each is its own,
 * larger étape. Reuses DriverPlaceholder (components/driver/
 * driver-placeholder.tsx) verbatim - the SAME "coming soon" component the
 * web app itself already has for this exact situation - never a new ad-hoc
 * placeholder design.
 *
 * `icon: DriverNavItem["icon"]` (never a bare `LucideIcon` imported straight
 * from "lucide-react") deliberately: this shell has its OWN separately
 * installed lucide-react copy (mobile/driver/node_modules), so a LucideIcon
 * type resolved from a plain import here is a nominally DIFFERENT type from
 * the one driverNavItems.ts (repo root) and DriverPlaceholder's own `icon`
 * prop already use - passing one where the other is expected then fails to
 * typecheck despite being the exact same runtime component. Deriving the
 * type from DriverNavItem itself guarantees both sides agree.
 */
export function MigrationPendingScreen({
  label,
  icon,
  onBack,
}: {
  label: string;
  icon: DriverNavItem["icon"];
  onBack: () => void;
}) {
  return (
    <div className="min-h-dvh bg-background">
      <header className="flex items-center gap-2 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <button
          type="button"
          onClick={onBack}
          className="-ml-2 inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Accueil
        </button>
      </header>
      <div className="px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <DriverPlaceholder
          title={label}
          description="En cours de migration depuis l'application historique."
          icon={icon}
        />
      </div>
    </div>
  );
}
