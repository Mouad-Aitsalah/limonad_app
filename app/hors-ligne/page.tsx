import type { Metadata } from "next";

import { OfflinePosShell } from "@/components/pos/offline-pos-shell";

export const metadata: Metadata = {
  title: "Point de Vente - Hors connexion | COMDIS",
};

// Static on purpose: it is what the service worker keeps for offline start-up,
// so it must contain no user or organization data. Everything personal comes
// from the local offline session, decided client side (see OfflinePosShell).
export default function OfflinePage() {
  return <OfflinePosShell />;
}
