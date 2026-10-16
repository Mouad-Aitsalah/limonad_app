import "server-only";

import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { z } from "zod";

import {
  DASHBOARD_ATTEMPT_WINDOW_MS,
  DASHBOARD_GRANT_IDLE_MS,
  DASHBOARD_GRANT_MAX_MS,
  DASHBOARD_GRANT_SLIDE_THRESHOLD_MS,
  DASHBOARD_MAX_FAILED_ATTEMPTS,
  DASHBOARD_RENEWAL_PERIODS,
  DEFAULT_DASHBOARD_RENEWAL_PERIOD,
  computeDashboardPasswordExpiry,
  evaluateDashboardSecurity,
  validateDashboardPassword,
  type DashboardGateDto,
  type DashboardSecurityState,
  type OrganizationDashboardSecurityDto,
} from "@/lib/dashboard-security";
import { BCRYPT_COST } from "@/lib/password-hashing";
import { prisma } from "@/lib/prisma";
import { AuthServiceError, getCurrentSessionTokenHash } from "@/lib/server/auth";
import {
  requireOrganizationUser,
  requireSuperAdmin,
  type OrganizationSessionUser,
} from "@/lib/server/organization-context";

/**
 * « Sécurité du dashboard » - server side (the browser is never trusted).
 *
 * - The SUPER_ADMIN switches the security on/off per organisation, sets the renewal and can
 *   reset the dashboard password. He can never read it: only a bcrypt hash is stored, and no
 *   function here ever returns it.
 * - When the security is ON, every dashboard data function calls requireDashboardAccess(): no
 *   data is returned without a valid DashboardAccessGrant tied to the authenticated session, the
 *   user, the organisation and the current securityVersion.
 * - The browser only holds an opaque random token (httpOnly cookie, DASHBOARD_GRANT_COOKIE);
 *   its SHA-256 is what the database stores. Grants slide on use (idle expiry), are deleted when
 *   the user leaves the dashboard and are all invalidated by a reset / (de)activation.
 * - Wrong-password attempts are counted in the database (works on Vercel) and refused past the limit.
 */

export const DASHBOARD_GRANT_COOKIE = "comdis.dashboard";

/** Roles that can open /dashboard (and therefore must pass the gate when the security is on). */
export const DASHBOARD_VIEW_ROLES = ["admin", "depot_manager", "cashier"] as const;

/** Thrown by requireDashboardAccess: mapped to a 403 by every dashboard route (it is an AuthServiceError). */
export class DashboardLockedError extends AuthServiceError {
  readonly code = "DASHBOARD_LOCKED";
  constructor() {
    super("Dashboard verrouillé. Saisissez le mot de passe du dashboard.", 403);
  }
}

const INVALID_PASSWORD_MESSAGE = "Mot de passe invalide.";
const TOO_MANY_ATTEMPTS_MESSAGE = "Trop de tentatives. Réessayez dans quelques minutes.";

function hashGrantToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function readSecurity(organizationId: string) {
  try {
    return await prisma.organizationDashboardSecurity.findUnique({ where: { organizationId } });
  } catch (error) {
    // P2021 = the table does not exist yet (migration not applied): the security cannot have been
    // switched on, so the dashboard stays exactly as before instead of breaking.
    if ((error as { code?: unknown } | null)?.code === "P2021") return null;
    throw error;
  }
}
type SecurityRow = NonNullable<Awaited<ReturnType<typeof readSecurity>>>;

function stateOf(security: SecurityRow | null, now: Date): DashboardSecurityState {
  if (!security) return "disabled";
  return evaluateDashboardSecurity(
    {
      enabled: security.enabled,
      hasPassword: Boolean(security.passwordHash),
      renewalEnabled: security.renewalEnabled,
      passwordExpiresAt: security.passwordExpiresAt,
    },
    now,
  );
}

function attemptKey(user: { id: string; organizationId: string }): string {
  return `${user.organizationId}:${user.id}`;
}

// --- Grant (temporary authorization) -------------------------------------------------------

async function readGrantCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(DASHBOARD_GRANT_COOKIE)?.value ?? null;
}

/** True when the request carries a live grant for THIS session, user, organisation and securityVersion. */
async function hasValidGrant(user: OrganizationSessionUser, security: SecurityRow, now: Date): Promise<boolean> {
  const token = await readGrantCookie();
  if (!token) return false;
  const sessionTokenHash = await getCurrentSessionTokenHash();
  if (!sessionTokenHash) return false;

  const grant = await prisma.dashboardAccessGrant.findUnique({ where: { tokenHash: hashGrantToken(token) } });
  if (!grant) return false;
  if (
    grant.organizationId !== user.organizationId ||
    grant.userId !== user.id ||
    grant.sessionTokenHash !== sessionTokenHash ||
    grant.securityVersion !== security.securityVersion
  ) {
    return false;
  }
  const nowMs = now.getTime();
  if (grant.expiresAt.getTime() <= nowMs) return false;
  if (grant.createdAt.getTime() + DASHBOARD_GRANT_MAX_MS <= nowMs) return false;

  // Slide the idle expiry (at most one write a minute), never past the absolute cap.
  const wanted = Math.min(nowMs + DASHBOARD_GRANT_IDLE_MS, grant.createdAt.getTime() + DASHBOARD_GRANT_MAX_MS);
  if (wanted - grant.expiresAt.getTime() > DASHBOARD_GRANT_SLIDE_THRESHOLD_MS) {
    await prisma.dashboardAccessGrant
      .update({ where: { id: grant.id }, data: { expiresAt: new Date(wanted) } })
      .catch(() => undefined);
  }
  return true;
}

async function issueGrant(
  db: Pick<typeof prisma, "dashboardAccessGrant">,
  user: OrganizationSessionUser,
  security: { securityVersion: number },
  now: Date,
): Promise<string> {
  const sessionTokenHash = await getCurrentSessionTokenHash();
  if (!sessionTokenHash) throw new AuthServiceError("Session introuvable.", 401);
  const token = randomBytes(32).toString("base64url");
  // One grant per session and organisation; expired ones are swept at the same time.
  await db.dashboardAccessGrant.deleteMany({
    where: {
      OR: [{ sessionTokenHash, organizationId: user.organizationId }, { expiresAt: { lt: new Date(now.getTime() - 60_000) } }],
    },
  });
  await db.dashboardAccessGrant.create({
    data: {
      tokenHash: hashGrantToken(token),
      organizationId: user.organizationId,
      userId: user.id,
      sessionTokenHash,
      securityVersion: security.securityVersion,
      expiresAt: new Date(now.getTime() + DASHBOARD_GRANT_IDLE_MS),
    },
  });
  return token;
}

// --- Gate (organisation side) --------------------------------------------------------------

/** `secured`: the security is on and a valid grant was presented (the page then watches for the user leaving). */
export type DashboardAccess = { status: "open"; secured: boolean } | { status: "gate"; gate: DashboardGateDto };

/**
 * What /dashboard must show for the connected user: the dashboard itself ("open": security off, or a
 * valid grant) or the gate (create / renew / unlock). The page renders NO data in the gate case.
 *
 * `newVisit`: the page was requested as a full document (address bar, reload, bookmark, link from another site,
 * new tab) rather than by an in-app navigation. That is a new visit: any authorization of this session is
 * deleted first, so the password is asked again.
 */
export async function resolveDashboardAccess(
  user: OrganizationSessionUser,
  options: { newVisit?: boolean } = {},
): Promise<DashboardAccess> {
  const now = new Date();
  const security = await readSecurity(user.organizationId);
  const state = stateOf(security, now);
  if (state === "disabled" || !security) return { status: "open", secured: false };
  if (options.newVisit) await revokeSessionGrants(user);
  if (state === "unlock_required" && (await hasValidGrant(user, security, now))) return { status: "open", secured: true };
  return {
    status: "gate",
    gate: {
      state,
      canSetPassword: user.role === "admin",
      renewalEnabled: security.renewalEnabled,
      renewalPeriod: security.renewalPeriod,
      passwordExpiresAt: security.passwordExpiresAt?.toISOString() ?? null,
    },
  };
}

/**
 * The single guard of every dashboard data function (page sections AND /api/dashboard/**): throws a
 * 403 DashboardLockedError unless the security is off or the request holds a valid grant. Cost when the
 * security is off: one indexed read.
 */
export async function requireDashboardAccess(user: OrganizationSessionUser): Promise<void> {
  const access = await resolveDashboardAccess(user);
  if (access.status !== "open") throw new DashboardLockedError();
}

// --- Unlock / create / leave (organisation side) -------------------------------------------

/** Records the attempt FIRST (race-safe), then refuses once the window holds too many. */
async function registerAttempt(user: OrganizationSessionUser): Promise<void> {
  const key = attemptKey(user);
  const since = new Date(Date.now() - DASHBOARD_ATTEMPT_WINDOW_MS);
  await prisma.dashboardUnlockAttempt.create({ data: { key } });
  const count = await prisma.dashboardUnlockAttempt.count({ where: { key, createdAt: { gte: since } } });
  if (count > DASHBOARD_MAX_FAILED_ATTEMPTS) throw new AuthServiceError(TOO_MANY_ATTEMPTS_MESSAGE, 429);
  // Housekeeping: old rows of this key are useless.
  await prisma.dashboardUnlockAttempt.deleteMany({ where: { key, createdAt: { lt: since } } }).catch(() => undefined);
}

async function clearAttempts(user: OrganizationSessionUser): Promise<void> {
  await prisma.dashboardUnlockAttempt.deleteMany({ where: { key: attemptKey(user) } }).catch(() => undefined);
}

const unlockSchema = z.object({ password: z.string().min(1).max(256) });

/** Validates the dashboard password and returns the opaque grant token (the route puts it in the cookie). */
export async function unlockDashboard(input: unknown): Promise<{ grantToken: string }> {
  const user = await requireOrganizationUser([...DASHBOARD_VIEW_ROLES]);
  const parsed = unlockSchema.safeParse(input);
  if (!parsed.success) throw new AuthServiceError(INVALID_PASSWORD_MESSAGE, 400);

  await registerAttempt(user);

  const now = new Date();
  const security = await readSecurity(user.organizationId);
  const state = stateOf(security, now);
  if (!security || state !== "unlock_required" || !security.passwordHash) {
    // Security off, nothing to unlock yet, or expired: same answer as a wrong password.
    throw new AuthServiceError(INVALID_PASSWORD_MESSAGE, 401);
  }
  const matches = await bcrypt.compare(parsed.data.password, security.passwordHash);
  if (!matches) throw new AuthServiceError(INVALID_PASSWORD_MESSAGE, 401);

  await clearAttempts(user);
  return { grantToken: await issueGrant(prisma, user, security, now) };
}

const setPasswordSchema = z.object({
  password: z.string().min(1).max(256),
  confirmation: z.string().min(1).max(256),
});

/**
 * First creation, or renewal of an expired password. ADMIN of the organisation only. Stores only the
 * bcrypt hash, the creation date and (renewal on) the expiry date; invalidates every previous grant and
 * opens the dashboard for the admin who just set it.
 */
export async function setDashboardPassword(input: unknown): Promise<{ grantToken: string; passwordExpiresAt: string | null }> {
  const user = await requireOrganizationUser(["admin"]);
  const parsed = setPasswordSchema.safeParse(input);
  if (!parsed.success) throw new AuthServiceError("Saisissez le mot de passe et sa confirmation.", 422);
  const { password, confirmation } = parsed.data;
  if (password !== confirmation) throw new AuthServiceError("Les deux mots de passe ne correspondent pas.", 422);
  const weak = validateDashboardPassword(password);
  if (weak) throw new AuthServiceError(weak, 422);

  const now = new Date();
  const security = await readSecurity(user.organizationId);
  const state = stateOf(security, now);
  if (!security || (state !== "creation_required" && state !== "renewal_required")) {
    throw new AuthServiceError("Aucun mot de passe dashboard à définir pour le moment.", 409);
  }

  // A dedicated password: never the account's login password (guessing is rate limited), never the previous one.
  const account = await prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
  const sameAsLogin = account ? await bcrypt.compare(password, account.passwordHash) : false;
  const sameAsPrevious = security.passwordHash ? await bcrypt.compare(password, security.passwordHash) : false;
  if (sameAsLogin || sameAsPrevious) {
    await registerAttempt(user);
    throw new AuthServiceError(
      "Choisissez un mot de passe différent de celui de votre compte et de l'ancien mot de passe du dashboard.",
      422,
    );
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const passwordExpiresAt = computeDashboardPasswordExpiry(now, security.renewalEnabled, security.renewalPeriod);
  const nextVersion = security.securityVersion + 1;

  const grantToken = await prisma.$transaction(async (tx) => {
    // Optimistic guard: only if nobody changed the password / version since we read it.
    const updated = await tx.organizationDashboardSecurity.updateMany({
      where: {
        organizationId: user.organizationId,
        enabled: true,
        securityVersion: security.securityVersion,
        passwordHash: security.passwordHash,
      },
      data: { passwordHash, passwordSetAt: now, passwordExpiresAt, securityVersion: nextVersion },
    });
    if (updated.count !== 1) throw new AuthServiceError("Le mot de passe vient d'être modifié. Rechargez la page.", 409);

    await tx.dashboardAccessGrant.deleteMany({ where: { organizationId: user.organizationId } });
    await tx.auditLog.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        action: state === "creation_required" ? "DASHBOARD_PASSWORD_CREATED" : "DASHBOARD_PASSWORD_RENEWED",
        entityType: "Organization",
        entityId: user.organizationId,
        newValue: { renewalEnabled: security.renewalEnabled, passwordExpiresAt: passwordExpiresAt?.toISOString() ?? null },
      },
    });
    return issueGrant(tx, user, { securityVersion: nextVersion }, now);
  });

  await clearAttempts(user);
  return { grantToken, passwordExpiresAt: passwordExpiresAt?.toISOString() ?? null };
}

async function revokeSessionGrants(user: OrganizationSessionUser): Promise<void> {
  const sessionTokenHash = await getCurrentSessionTokenHash();
  if (!sessionTokenHash) return;
  await prisma.dashboardAccessGrant.deleteMany({
    where: { sessionTokenHash, organizationId: user.organizationId, userId: user.id },
  });
}

/** Leaving the dashboard: deletes this session's grant so the next visit asks the password again. */
export async function lockDashboard(): Promise<void> {
  await revokeSessionGrants(await requireOrganizationUser());
}

// --- SUPER_ADMIN side ----------------------------------------------------------------------

function toAdminDto(organizationId: string, security: SecurityRow | null): OrganizationDashboardSecurityDto {
  return {
    organizationId,
    enabled: security?.enabled ?? false,
    renewalEnabled: security?.renewalEnabled ?? false,
    renewalPeriod: security?.renewalPeriod ?? DEFAULT_DASHBOARD_RENEWAL_PERIOD,
    passwordSet: Boolean(security?.passwordHash),
    passwordSetAt: security?.passwordSetAt?.toISOString() ?? null,
    passwordExpiresAt: security?.passwordExpiresAt?.toISOString() ?? null,
    state: stateOf(security, new Date()),
  };
}

async function requireOrganization(organizationId: string): Promise<void> {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!organization) throw new AuthServiceError("Organisation introuvable.", 404);
}

export async function getOrganizationDashboardSecurity(organizationId: string): Promise<OrganizationDashboardSecurityDto> {
  await requireSuperAdmin();
  await requireOrganization(organizationId);
  return toAdminDto(organizationId, await readSecurity(organizationId));
}

const updateSchema = z.object({
  enabled: z.boolean(),
  renewalEnabled: z.boolean(),
  renewalPeriod: z.enum(DASHBOARD_RENEWAL_PERIODS),
});

/**
 * Body: { enabled, renewalEnabled, renewalPeriod }. Only the organisation of the URL is touched. Switching
 * the security on/off bumps the securityVersion (every grant ever issued stops working); the stored hash is
 * never deleted by this call. The expiry is recomputed from the password creation date.
 */
export async function updateOrganizationDashboardSecurity(
  organizationId: string,
  input: unknown,
): Promise<OrganizationDashboardSecurityDto> {
  const superAdmin = await requireSuperAdmin();
  await requireOrganization(organizationId);
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) throw new AuthServiceError("Paramètres de sécurité invalides.", 422);
  const { enabled, renewalEnabled, renewalPeriod } = parsed.data;

  const saved = await prisma.$transaction(async (tx) => {
    const before = await tx.organizationDashboardSecurity.findUnique({ where: { organizationId } });
    const expiresAt =
      before?.passwordHash && before.passwordSetAt
        ? computeDashboardPasswordExpiry(before.passwordSetAt, renewalEnabled, renewalPeriod)
        : null;
    const toggled = (before?.enabled ?? false) !== enabled;
    const row = await tx.organizationDashboardSecurity.upsert({
      where: { organizationId },
      create: { organizationId, enabled, renewalEnabled, renewalPeriod, passwordExpiresAt: expiresAt },
      update: {
        enabled,
        renewalEnabled,
        renewalPeriod,
        passwordExpiresAt: expiresAt,
        ...(toggled ? { securityVersion: { increment: 1 } } : {}),
      },
    });
    if (toggled) await tx.dashboardAccessGrant.deleteMany({ where: { organizationId } });
    await tx.auditLog.create({
      data: {
        organizationId,
        userId: superAdmin.id,
        action: "DASHBOARD_SECURITY_UPDATED",
        entityType: "Organization",
        entityId: organizationId,
        oldValue: {
          enabled: before?.enabled ?? false,
          renewalEnabled: before?.renewalEnabled ?? false,
          renewalPeriod: before?.renewalPeriod ?? DEFAULT_DASHBOARD_RENEWAL_PERIOD,
        },
        newValue: { enabled, renewalEnabled, renewalPeriod },
      },
    });
    return row;
  });
  return toAdminDto(organizationId, saved);
}

/**
 * « Réinitialiser le mot de passe dashboard »: the previous password stops working at once, the admin must
 * create a new one at the next access, every temporary authorization of the organisation is deleted and the
 * failed-attempt counters are cleared. Only the organisation of the URL is touched.
 */
export async function resetOrganizationDashboardPassword(organizationId: string): Promise<OrganizationDashboardSecurityDto> {
  const superAdmin = await requireSuperAdmin();
  await requireOrganization(organizationId);
  const saved = await prisma.$transaction(async (tx) => {
    const row = await tx.organizationDashboardSecurity.upsert({
      where: { organizationId },
      create: { organizationId },
      update: { passwordHash: null, passwordSetAt: null, passwordExpiresAt: null, securityVersion: { increment: 1 } },
    });
    await tx.dashboardAccessGrant.deleteMany({ where: { organizationId } });
    await tx.dashboardUnlockAttempt.deleteMany({ where: { key: { startsWith: `${organizationId}:` } } });
    await tx.auditLog.create({
      data: {
        organizationId,
        userId: superAdmin.id,
        action: "DASHBOARD_PASSWORD_RESET",
        entityType: "Organization",
        entityId: organizationId,
      },
    });
    return row;
  });
  return toAdminDto(organizationId, saved);
}

