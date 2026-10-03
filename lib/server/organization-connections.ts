import "server-only";

import { prisma } from "@/lib/prisma";
import { OperationsServiceError } from "@/lib/server/depots";
import { requireSuperAdmin } from "@/lib/server/organization-context";
import {
  buildOrganizationConnections,
  loadSessionsWithDeviceFallback,
  ONLINE_WINDOW_MS,
  type OrganizationConnectionsSnapshot,
} from "@/lib/session-activity";

/**
 * Live connected-devices snapshot of ONE organization, for the SUPER_ADMIN
 * "Detail organisation" page. Reuses the existing server-side sessions
 * (Session rows: revoked on logout, expiring, with a lastUsedAt stamp kept
 * fresh by the client heartbeat and by every authenticated request).
 *
 * Security: SUPER_ADMIN only (requireSuperAdmin); every query is scoped to
 * the users of the requested organization; the result only holds per-user
 * counts - never a token, a token hash, a session id or a device id.
 */
export async function getOrganizationConnections(
  organizationId: string,
): Promise<OrganizationConnectionsSnapshot> {
  await requireSuperAdmin();

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true },
  });
  if (!organization) {
    throw new OperationsServiceError("Organisation introuvable.", 404);
  }

  const users = await prisma.user.findMany({
    where: { organizationId: organization.id },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  const userIds = users.map((user) => user.id);

  const now = new Date();
  const since = new Date(now.getTime() - ONLINE_WINDOW_MS);
  if (userIds.length === 0) {
    return buildOrganizationConnections(userIds, [], now);
  }

  const where = {
    userId: { in: userIds },
    revokedAt: null,
    expiresAt: { gt: now },
    OR: [{ lastUsedAt: { gte: since } }, { lastUsedAt: null, createdAt: { gte: since } }],
  };
  const baseSelect = {
    id: true,
    userId: true,
    createdAt: true,
    lastUsedAt: true,
    expiresAt: true,
    revokedAt: true,
  } as const;

  // Session.deviceId is added by migration 20261003100000_add_session_device_id.
  // The build on Vercel does not run migrations, so the code can be live before
  // the column exists: in that case (and only that case) fall back to counting
  // one device per active session instead of answering 500.
  const { sessions, deviceTracking } = await loadSessionsWithDeviceFallback(
    () => prisma.session.findMany({ where, select: { ...baseSelect, deviceId: true } }),
    () => prisma.session.findMany({ where, select: baseSelect }),
  );
  if (deviceTracking === "session") {
    console.warn(
      "[connections] Session.deviceId column missing - apply migration 20261003100000_add_session_device_id (counting per session meanwhile)",
    );
  }

  return buildOrganizationConnections(userIds, sessions, now, deviceTracking);
}
