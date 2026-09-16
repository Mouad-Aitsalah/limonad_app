import { hydrateDriverOfflineCache } from "@/lib/offline/driver-pos";
import type { DriverPosContextDto } from "@/types/operations-dto";

import { mobileFetch } from "./mobile-fetch";

type OrganizationIdentity = { name: string; tradeName: string | null; logoUrl: string | null };
type OrganizationIdentityResponse = { identity: OrganizationIdentity | null };

/**
 * CORRECTION PHASE OFFLINE (contexte chauffeur incomplet) - full hydration
 * of offline_context, reusing hydrateDriverOfflineCache UNCHANGED (the exact
 * function components/driver-pos/driver-pos-view.tsx already calls after
 * every online context load) - no new business logic, only wiring. Its side
 * effect of also caching products/customers/truck-stock is the same
 * already-validated behavior, not a new "offline sales" feature.
 *
 * organizationName is not part of DriverPosContextDto (a driver only ever
 * has one org, so the DTO never carries its name) - the web app itself
 * sources it from a separate call (see hooks/use-company-identity.tsx),
 * GET /api/organization/identity. Same call here, Bearer-authenticated.
 *
 * CORRECTION BUG-01 "CLIENTS NON DISPONIBLES OFFLINE": this runs on EVERY
 * boot/login while online (see App.tsx) - `skipCustomersCache: true` for the
 * exact same reason as driver-pos-data-source.ts's own call: `driverPos
 * Context.customers` here is always the small POS preload, and letting this
 * write cached_customers would silently clobber the COMPLETE list a
 * previous session's PosScreen (refreshFullDriverCustomerCache) already
 * cached, every single time the app is reopened online - before the driver
 * even gets a chance to open POS again and have it restored.
 */
export async function refreshOfflineContextFromServer(params: {
  token: string;
  organizationId: string;
  userId: string;
  userName: string;
  driverPosContext: DriverPosContextDto;
}): Promise<void> {
  const identityOutcome = await mobileFetch<OrganizationIdentityResponse>(
    "/api/organization/identity",
    params.token,
  );
  const organizationName =
    identityOutcome.kind === "ok"
      ? (identityOutcome.data.identity?.tradeName ?? identityOutcome.data.identity?.name ?? null)
      : null;

  await hydrateDriverOfflineCache({
    organizationId: params.organizationId,
    organizationName,
    userId: params.userId,
    userName: params.userName,
    context: params.driverPosContext,
    skipCustomersCache: true,
  });
}
