"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CloudOff, Loader2, LogOut, RefreshCw } from "lucide-react";

import { PosLayout } from "@/components/pos/pos-layout";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { AuthContext, type AuthContextValue } from "@/hooks/use-auth";
import {
  cleanupOnLogout,
  getNetworkState,
  offlineSessionToCurrentUser,
  resolveOfflineStartup,
  type OfflineStartupResult,
} from "@/lib/offline/counter-pos";

const LOGIN_REQUIRED_MESSAGES = {
  MISSING:
    "La première connexion nécessite Internet. Connectez-vous une fois avec Internet pour activer l'utilisation hors connexion.",
  EXPIRED:
    "Votre session hors connexion a expiré. Reconnectez-vous avec Internet pour la renouveler.",
  INVALID:
    "La session hors connexion de ce poste n'est pas valide. Reconnectez-vous avec Internet.",
  STORAGE_ERROR:
    "Le stockage local de ce navigateur n'est pas disponible : l'utilisation hors connexion est impossible.",
} as const;

/**
 * The page the service worker serves when COMDIS is started without Internet.
 * It decides EXPLICITLY, client side, whether this PC may open the counter
 * POS: only a valid offline session (written after a real online login) opens
 * it, as that very user/role/organization, on that organization's local data.
 * Anything else shows why not. It offers no way to pick a user or an
 * organization, and it reaches no server page.
 */
export function OfflinePosShell() {
  const router = useRouter();
  const [startup, setStartup] = React.useState<OfflineStartupResult | "loading">("loading");
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    void (async () => {
      // Reached with a working server (typed by hand, or the connection came
      // back): the normal POS is the right place, through the normal login.
      if ((await getNetworkState()) === "ONLINE") {
        router.replace("/pos");
        return;
      }
      const result = await resolveOfflineStartup();
      if (active) setStartup(result);
    })();
    return () => {
      active = false;
    };
  }, [attempt, router]);

  const signOut = React.useCallback(async () => {
    await cleanupOnLogout();
    router.replace("/login");
  }, [router]);

  const authValue = React.useMemo<AuthContextValue | null>(() => {
    if (typeof startup === "string" || startup.state !== "READY") return null;
    return {
      currentUser: offlineSessionToCurrentUser(startup.session),
      isLoading: false,
      login: async () => ({
        success: false,
        error: "La connexion nécessite Internet.",
      }),
      logout: signOut,
      refreshSession: async () => {},
    };
  }, [startup, signOut]);

  if (startup === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30">
        <Loader2 aria-hidden="true" className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (startup.state !== "READY" || !authValue) {
    const message =
      startup.state === "LOGIN_REQUIRED"
        ? LOGIN_REQUIRED_MESSAGES[startup.reason]
        : "Les produits et les clients ne sont pas encore synchronisés sur ce poste. Ouvrez le point de vente une fois avec Internet.";
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
        <div
          role="alert"
          data-testid="offline-shell-blocked"
          className="w-full max-w-md space-y-4 rounded-3xl border border-border bg-card p-6 shadow-sm"
        >
          <div className="flex items-center gap-2 text-amber-800">
            <CloudOff aria-hidden="true" className="h-5 w-5" />
            <h1 className="font-heading text-lg font-semibold">Hors connexion</h1>
          </div>
          <p className="text-sm text-muted-foreground">{message}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => setAttempt((value) => value + 1)}>
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
              Réessayer
            </Button>
            <Button type="button" variant="outline" onClick={() => window.location.assign("/login")}>
              Aller à la connexion
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const { session, context } = startup;
  return (
    <AuthContext.Provider value={authValue}>
      <div className="mx-auto max-w-[1600px] space-y-4 p-3 lg:p-6" data-testid="offline-shell-pos">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-heading text-2xl font-semibold text-foreground">Point de Vente</h1>
            <p className="text-sm text-muted-foreground">
              {session.name || "Utilisateur"} ·{" "}
              {session.role === "admin" ? "Administrateur" : "Caissier"} · session hors connexion
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void signOut()}>
            <LogOut aria-hidden="true" className="h-4 w-4" />
            Se déconnecter
          </Button>
        </div>
        <React.Suspense fallback={null}>
          <PosLayout initialContext={context} offlineShell />
        </React.Suspense>
      </div>
      <Toaster position="top-right" />
    </AuthContext.Provider>
  );
}
