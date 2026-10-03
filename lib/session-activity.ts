/**
 * Live-connection rules for the SUPER_ADMIN "appareils connectes" view.
 * Pure (no `server-only`, no Prisma) so the rules are unit-tested.
 *
 * A device counts as connected when it has a session that is:
 *  - not revoked (logout / revokeAll sets revokedAt),
 *  - not expired (expiresAt in the future),
 *  - recently active: its last activity (lastUsedAt, or createdAt for a
 *    session that never made a request) is within ONLINE_WINDOW_MS.
 * A registered device or a still-valid-but-idle session is NOT "connected".
 */

/** Silence longer than this => the session no longer counts as connected. */
export const ONLINE_WINDOW_MS = 5 * 60 * 1000;

/** The web client pings every minute while the tab is visible. */
export const HEARTBEAT_INTERVAL_MS = 60 * 1000;

/** Server-side throttle of the lastUsedAt write (must stay < the heartbeat). */
export const LAST_ACTIVITY_WRITE_THROTTLE_MS = 45 * 1000;

/** How often the SUPER_ADMIN page refreshes the counts. */
export const CONNECTIONS_REFRESH_MS = 20 * 1000;

export type ActivitySession = {
  id: string;
  userId: string;
  deviceId: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date;
  revokedAt: Date | null;
};

export type OrganizationConnectionsUser = {
  userId: string;
  devices: number;
  online: boolean;
};

export type OrganizationConnectionsSnapshot = {
  /** ISO time the snapshot was computed (server clock). */
  generatedAt: string;
  windowSeconds: number;
  totalDevices: number;
  onlineUsers: number;
  users: OrganizationConnectionsUser[];
};

export function lastActivityOf(session: ActivitySession): Date {
  return session.lastUsedAt ?? session.createdAt;
}

export function isSessionActive(session: ActivitySession, now: Date): boolean {
  if (session.revokedAt) return false;
  if (session.expiresAt.getTime() <= now.getTime()) return false;
  return now.getTime() - lastActivityOf(session).getTime() <= ONLINE_WINDOW_MS;
}

/**
 * Distinct active devices per user. One device = one deviceId; a session
 * without a deviceId is its own device (keyed by the session id), so two
 * such sessions are two devices while two sessions of the same deviceId are
 * one. Users with no active session are absent from the map.
 */
export function countActiveDevicesByUser(
  sessions: readonly ActivitySession[],
  now: Date,
): Map<string, number> {
  const devicesByUser = new Map<string, Set<string>>();
  for (const session of sessions) {
    if (!isSessionActive(session, now)) continue;
    const deviceKey = session.deviceId ? `d:${session.deviceId}` : `s:${session.id}`;
    const set = devicesByUser.get(session.userId) ?? new Set<string>();
    set.add(deviceKey);
    devicesByUser.set(session.userId, set);
  }
  return new Map([...devicesByUser].map(([userId, set]) => [userId, set.size]));
}

/**
 * Snapshot for ONE organization. `userIds` is the organization's own user
 * list; any session of a user outside it is ignored, so a caller can never
 * leak another organization's connections even if it passes extra sessions.
 */
export function buildOrganizationConnections(
  userIds: readonly string[],
  sessions: readonly ActivitySession[],
  now: Date,
): OrganizationConnectionsSnapshot {
  const allowed = new Set(userIds);
  const counts = countActiveDevicesByUser(
    sessions.filter((session) => allowed.has(session.userId)),
    now,
  );
  const users = userIds.map((userId) => {
    const devices = counts.get(userId) ?? 0;
    return { userId, devices, online: devices > 0 };
  });
  return {
    generatedAt: now.toISOString(),
    windowSeconds: ONLINE_WINDOW_MS / 1000,
    totalDevices: users.reduce((sum, user) => sum + user.devices, 0),
    onlineUsers: users.filter((user) => user.online).length,
    users,
  };
}

/** Accepts only the random ids this app generates (never arbitrary client text). */
export function isValidDeviceId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(value);
}
