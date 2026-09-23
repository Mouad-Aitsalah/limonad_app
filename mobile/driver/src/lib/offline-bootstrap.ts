import {
  getAnyDriverOfflineContext,
  getOfflineCacheDiagnostics,
  type DriverOfflineContext,
} from "@/lib/offline/driver-pos";
import type { DriverPosContextDto } from "@/types/operations-dto";

import { refreshFullDriverCustomerCache } from "./driver-pos-data-source";
import { MOBILE_FETCH_TIMEOUT_MESSAGE, mobileFetch } from "./mobile-fetch";
import { refreshOfflineContextFromServer } from "./refresh-offline-context";
import type { StoredMobileProfile } from "./secure-token-storage";

/**
 * ÉTAPE OFFLINE-BOOTSTRAP - prepares this device's offline data from REAL
 * server data, and tells the caller exactly what happened.
 *
 * Before: App.tsx's handleLoginSuccess fired GET /api/driver/pos and the
 * hydration without reporting any outcome - a failure left no offline_context
 * and no message, and the UI already showed "no offline data" while it ran.
 * This module is the one place that does the whole job and returns either the
 * real DriverOfflineContext or a classified, user-presentable error:
 *
 *   profile check -> GET /api/driver/pos (Bearer) -> validate the answer ->
 *   refreshOfflineContextFromServer (identity, offline_context, products,
 *   stock, camion - the existing, unchanged function) -> full customer list ->
 *   read everything back from SQLite.
 *
 * Nothing is created artificially: the returned context is read back from
 * SQLite AFTER the server data was written, and the caller only gets it once
 * every step has finished - the driver can never enter the POS while
 * products/customers/stock/truck are still being written.
 *
 * Log convention: [OFFLINE BOOT] progress lines only in DEV builds;
 * [OFFLINE BOOT ERROR] (stage/status/message - never a token or password) is
 * always emitted so a failure is diagnosable on a release APK too.
 */

export type OfflineBootstrapStage = "profile" | "pos_context" | "hydrate" | "verify";

export type OfflineBootstrapErrorKind =
  | "no_driver_profile"
  | "timeout"
  | "network"
  | "unauthorized"
  | "forbidden"
  | "server"
  | "invalid_response"
  | "sqlite";

export type OfflineBootstrapError = {
  stage: OfflineBootstrapStage;
  kind: OfflineBootstrapErrorKind;
  status: number | null;
  /** Ready to show to the driver - no stack trace, no technical detail. */
  message: string;
};

export type OfflineBootstrapResult =
  | { ok: true; context: DriverOfflineContext }
  | { ok: false; error: OfflineBootstrapError };

function log(message: string, detail?: unknown) {
  if (!import.meta.env.DEV) return;
  if (detail === undefined) console.log(`[OFFLINE BOOT] ${message}`);
  else console.log(`[OFFLINE BOOT] ${message}`, detail);
}

function fail(
  stage: OfflineBootstrapStage,
  kind: OfflineBootstrapErrorKind,
  status: number | null,
  message: string,
  technical?: string,
): OfflineBootstrapResult {
  console.warn("[OFFLINE BOOT ERROR]", `stage=${stage}`, `kind=${kind}`, `status=${status ?? "-"}`, `message=${technical ?? message}`);
  return { ok: false, error: { stage, kind, status, message } };
}

export async function bootstrapOfflineData(params: {
  token: string;
  profile: StoredMobileProfile;
  /** A DriverPosContextDto the caller ALREADY fetched with this same token
   *  (the boot-time verification) - reused instead of a second identical call. */
  preloadedPosContext?: DriverPosContextDto | null;
}): Promise<OfflineBootstrapResult> {
  const { token, profile } = params;

  if (!profile.organizationId || !profile.driverId) {
    return fail(
      "profile",
      "no_driver_profile",
      null,
      "Ce compte n'a pas de profil chauffeur. Contactez votre administrateur.",
      "user has no organizationId/driverId",
    );
  }
  const organizationId = profile.organizationId;

  let posContext = params.preloadedPosContext ?? null;
  if (!posContext) {
    log("fetching driver POS context");
    const outcome = await mobileFetch<{ context?: DriverPosContextDto }>("/api/driver/pos", token);
    switch (outcome.kind) {
      case "ok":
        posContext = outcome.data?.context ?? null;
        break;
      case "unauthorized":
        return fail("pos_context", "unauthorized", 401, "Session expiree. Reconnectez-vous.");
      case "server_error":
        if (outcome.status === 403) {
          return fail("pos_context", "forbidden", 403, "Acces refuse pour ce compte. Contactez votre administrateur.", outcome.message);
        }
        return fail(
          "pos_context",
          "server",
          outcome.status,
          outcome.status >= 500
            ? `Le serveur a rencontre une erreur (code ${outcome.status}). Reessayez dans un instant.`
            : outcome.message,
          outcome.message,
        );
      case "network_error":
        return outcome.message === MOBILE_FETCH_TIMEOUT_MESSAGE
          ? fail("pos_context", "timeout", null, "Le serveur met trop de temps a repondre. Verifiez votre connexion puis reessayez.")
          : fail("pos_context", "network", null, "Connexion impossible. Verifiez Internet puis reessayez.", outcome.message);
    }
  }

  if (!posContext || !posContext.driver?.id || !Array.isArray(posContext.products)) {
    return fail("pos_context", "invalid_response", null, "Reponse du serveur invalide. Reessayez.", "POS context missing driver/products");
  }
  log("driver POS context received", { products: posContext.products.length, truck: Boolean(posContext.truck), canSell: posContext.canSell });

  log("hydrating SQLite");
  await refreshOfflineContextFromServer({
    token,
    organizationId,
    userId: profile.id,
    userName: profile.nom,
    driverPosContext: posContext,
  });

  // The stores fail soft (a broken write returns false, never throws), so the
  // only reliable proof is to read the data back.
  const context = await getAnyDriverOfflineContext();
  if (!context || context.organizationId !== organizationId || context.driverId !== posContext.driver.id) {
    return fail("verify", "sqlite", null, "Impossible d'enregistrer les donnees hors connexion sur cet appareil.", "offline_context not readable after hydration");
  }
  log("offline context saved");

  const counts = await getOfflineCacheDiagnostics({ organizationId, driverId: context.driverId });
  log("cache counts", counts);
  if (posContext.products.length > 0 && counts.productsCount === 0) {
    return fail("verify", "sqlite", null, "Impossible d'enregistrer les produits hors connexion sur cet appareil.", "cached_products empty after hydration");
  }
  if (posContext.truck && posContext.products.length > 0 && counts.stockRowsCount === 0) {
    return fail("verify", "sqlite", null, "Impossible d'enregistrer le stock du camion hors connexion sur cet appareil.", "cached_truck_stock empty after hydration");
  }
  log("truck cache refreshed");

  // The complete customer list (the POS context only carries a small preload).
  // Best-effort: a miss here leaves the preload/previous list in place and the
  // POS screen refreshes it again when opened online.
  const customers = await refreshFullDriverCustomerCache({ token, organizationId, driverId: context.driverId });
  log("customers cached", customers ? customers.length : "skipped (request failed)");

  log("offline bootstrap complete");
  return { ok: true, context };
}
