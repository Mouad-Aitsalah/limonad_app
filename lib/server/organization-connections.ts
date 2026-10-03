import "server-only";

import { prisma } from "@/lib/prisma";
import { OperationsServiceError } from "@/lib/server/depots";
import { requireSuperAdmin } from "@/lib/server/organization-context";
import { revokeUserSessionsInOrganization } from "@/lib/session-revocation";
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

/**
 * SUPER_ADMIN only: signs a user out of ALL their devices by revoking every
 * active session (revokedAt = now, one atomic updateMany; no row is deleted,
 * the account and the session history stay). The target must belong to the
 * given organization. Effective immediately on the server: the very next
 * request made with any of those sessions fails (see isSessionValid in
 * getCurrentSessionUser); the devices themselves return to the login page at
 * their next heartbeat (<= 1 minute while a tab is visible) or request.
 *
 * Never returns or logs a token, token hash, session id or device id.
 */
export async function revokeOrganizationUserSessions(organizationId: string, userId: string) {
  const actor = await requireSuperAdmin();

  const { revokedSessions } = await revokeUserSessionsInOrganization(
    {
      findUser: (id) =>
        prisma.user.findUnique({ where: { id }, select: { id: true, organizationId: true } }),
      revokeActiveSessions: async (id, now) => {
        const result = await prisma.session.updateMany({
          where: { userId: id, revokedAt: null, expiresAt: { gt: now } },
          data: { revokedAt: now },
        });
        return result.count;
      },
    },
    { actorRole: actor.role, organizationId, userId },
  );

  // Audit trail (ids and a count only).
  console.warn(
    `[auth] sessions revoked by super admin actor=${actor.id} user=${userId} organization=${organizationId} count=${revokedSessions} at=${new Date().toISOString()}`,
  );

  // Fresh counts for the UI; a failure here must not turn a successful
  // revocation into an error (the panel then simply re-polls).
  const connections = await getOrganizationConnections(organizationId).catch(() => null);
  return { revokedSessions, connections };
}
