/**
 * Rules for "Deconnecter tous les appareils" (SUPER_ADMIN, organization user
 * detail page). Pure and dependency-injected (no `server-only`, no Prisma) so
 * the security rules are unit-tested; lib/server/organization-connections.ts
 * wires it to the database.
 */

export class SessionRevocationError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export type RevocationDeps = {
  /** The user row (or null), looked up by id only - the scope check is done here. */
  findUser: (userId: string) => Promise<{ id: string; organizationId: string | null } | null>;
  /**
   * Revokes every active session (not revoked, not expired) of the user in ONE
   * atomic statement (sets revokedAt = now) and returns how many it revoked.
   * Never deletes a row: the session history stays.
   */
  revokeActiveSessions: (userId: string, now: Date) => Promise<number>;
};

export type RevocationInput = {
  /** Role of the authenticated caller (CurrentUser.role). */
  actorRole: string;
  organizationId: string;
  userId: string;
  now?: Date;
};

export async function revokeUserSessionsInOrganization(
  deps: RevocationDeps,
  input: RevocationInput,
): Promise<{ revokedSessions: number }> {
  // Defense in depth: the caller already went through requireSuperAdmin.
  if (input.actorRole !== "super_admin") {
    throw new SessionRevocationError("Acces non autorise.", 403);
  }

  const user = await deps.findUser(input.userId);
  // Same answer for "no such user" and "user of another organization", so the
  // endpoint cannot be used to probe which ids exist elsewhere.
  if (!user || user.organizationId !== input.organizationId) {
    throw new SessionRevocationError("Utilisateur introuvable dans cette organisation.", 404);
  }

  const revokedSessions = await deps.revokeActiveSessions(user.id, input.now ?? new Date());
  return { revokedSessions };
}
