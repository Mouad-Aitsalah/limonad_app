import { MobileLauncher } from "@/components/mobile/mobile-launcher";

import type { Screen } from "../navigation";

/**
 * PHASE 1 "RESTAURATION DU POS CHAUFFEUR" - ÉTAPE 26: renders the SAME
 * historical accueil the web app shows at /mobile for every role
 * (MobileLauncher, unchanged except for its ÉTAPE 26 optional props - see
 * that component's own doc comment) instead of DriverHomeScreen's
 * "Accueil chauffeur" hero-card screen (app/driver/page.tsx's DriverHomeView
 * - a DIFFERENT, desktop-oriented historical screen a driver never actually
 * sees on a real phone, see this étape's own audit). DriverHomeScreen.tsx is
 * left untouched, just no longer wired as HOME in App.tsx.
 *
 * This app is driver-only by construction (package ma.comdis.driver, one
 * single login flow, no role switch) - `currentUser={{ role: "driver" }}` is
 * therefore the one true, already-known fact, never invented data. It is the
 * ONLY per-user value MobileLauncher actually renders (the "Chauffeur" role
 * badge) - no organization identity/avatar image is displayed by this
 * component on web either, so there is nothing else to source locally.
 */
const HREF_TO_SCREEN: Record<string, Screen> = {
  "/driver/tournee": "TOURNEE",
  "/driver/pos": "POS",
  "/driver/stock": "STOCK",
  "/driver/clients": "CLIENTS",
  "/driver/ventes": "VENTES",
  "/driver": "CAMION",
};

export function DriverLauncherScreen({
  onNavigate,
  onLogout,
}: {
  onNavigate: (screen: Screen) => void;
  onLogout: () => void | Promise<void>;
}) {
  function handleNavigate(href: string) {
    const target = HREF_TO_SCREEN[href];
    if (target) onNavigate(target);
  }

  return (
    <MobileLauncher
      currentUser={{ role: "driver" }}
      onLogout={onLogout}
      onNavigate={handleNavigate}
    />
  );
}
