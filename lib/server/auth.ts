import "server-only";

import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import type { CurrentUser, UserRole } from "@/types/auth";

const SESSION_COOKIE = "comdis.session";
// Phase 5C: a full driver day (early start + a late close + margin) must fit
// inside one window so a driver logged in that morning is never bounced to
// /login mid-tour. Sliding renewal (refreshCurrentSession, below) keeps a
// still-active session alive past that, capped by an absolute ceiling so it
// is never an infinite session.
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 20;
// A session is never renewed past this many seconds from its creation - after
// it, the user re-authenticates. 14 days comfortably covers back-to-back
// working days without turning "stay logged in" into "logged in forever".
const SESSION_ABSOLUTE_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;
// Only slide the window (a DB write + a fresh Set-Cookie) once a session has
// burned through more than half its life - not on every session probe.
const SESSION_RENEW_WHEN_REMAINING_MS = (SESSION_MAX_AGE_SECONDS * 1000) / 2;
// Raw token size in bytes - >= the 32-byte minimum required. base64url keeps
// it compact and cookie/URL-safe (43 chars for 32 bytes, no padding).
const SESSION_TOKEN_BYTES = 32;
// getCurrentSessionUser() runs on every authenticated request; writing
// lastUsedAt on every single one would double the DB round trips on the
// hottest path in the app for a field that only needs rough freshness.
// Throttled instead: only touched if it is stale by more than this.
const LAST_USED_UPDATE_THRESHOLD_MS = 5 * 60 * 1000;

const userForSessionSelect = {
  id: true,
  firstName: true,
  lastName: true,
  fullName: true,
  email: true,
  role: true,
  status: true,
  organizationId: true,
  organization: {
    select: {
      id: true,
      status: true,
    },
  },
  driverProfile: {
    select: {
      id: true,
      truckId: true,
    },
  },
} as const;

export class AuthServiceError extends Error {
  constructor(
    message: string,
    public status = 401,
  ) {
    super(message);
  }
}

/**
 * Server-side, revocable sessions (see the Session model in schema.prisma).
 * The cookie only ever carries an opaque random token - never a user id,
 * role, or organization, and never anything derived from client input.
 * Every authenticated request re-reads the session AND the user fresh from
 * the database; nothing about identity or authorization is ever trusted
 * from the client itself, here or anywhere downstream.
 */
export async function loginWithPassword(email: string, password: string) {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { ...userForSessionSelect, passwordHash: true },
  });

  if (!user) {
    throw new AuthServiceError("Email ou mot de passe incorrect.", 401);
  }
  if (user.status !== "ACTIVE") {
    throw new AuthServiceError("Compte inactif ou bloque.", 403);
  }
  if (user.role !== "SUPER_ADMIN" && !user.organizationId) {
    throw new AuthServiceError("Ce compte n'est rattache a aucune organisation.", 403);
  }
  if (user.organization && user.organization.status !== "ACTIVE") {
    throw new AuthServiceError("Cette organisation est inactive.", 403);
  }

  const validPassword = await bcrypt.compare(password, user.passwordHash);
  if (!validPassword) {
    throw new AuthServiceError("Email ou mot de passe incorrect.", 401);
  }

  // A brand new random token/session is minted on every successful login,
  // never reused or extended from a prior one (prevents session fixation:
  // nothing an attacker could have pre-set - e.g. a token planted before
  // authentication - ever becomes the authenticated session, since this
  // token did not exist until this exact moment). Existing sessions for
  // this user (other devices/browsers) are intentionally left untouched -
  // logging in on a new device must not sign the user out elsewhere.
  await createSessionCookie(user.id);

  return mapUserToSession(user);
}

export async function getCurrentSessionUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const tokenHash = hashSessionToken(token);
  // A unique-index lookup by hash, not an in-memory string compare - there
  // is no secret being compared here for a timing attack to target (unlike
  // the password check below, which the more security-relevant timing risk,
  // and which already goes through bcrypt.compare's own constant-time
  // comparison).
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true, revokedAt: true, lastUsedAt: true },
  });

  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: userForSessionSelect,
  });

  if (!user || user.status !== "ACTIVE") return null;
  if (user.role !== "SUPER_ADMIN" && !user.organizationId) return null;
  if (user.organization && user.organization.status !== "ACTIVE") return null;

  const isStale =
    !session.lastUsedAt ||
    Date.now() - session.lastUsedAt.getTime() > LAST_USED_UPDATE_THRESHOLD_MS;
  if (isStale) {
    // Best-effort only: lastUsedAt is observability, not a security check -
    // a failed write here must never break authentication itself.
    await prisma.session
      .update({ where: { id: session.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
  }

  return mapUserToSession(user);
}

/**
 * Phase 5C - sliding session renewal. Same authority checks as
 * getCurrentSessionUser (revoked / expired / user still ACTIVE / org still
 * ACTIVE), and additionally, when the current session has burned through
 * more than half its window AND is still within the absolute ceiling from
 * its creation, extends `expiresAt` and re-issues the cookie with a fresh
 * max-age. Never resurrects an expired/revoked session, never renews past
 * the absolute cap - so a driver who keeps the app open all day stays
 * logged in, but a stale cookie left on a shelf still dies.
 *
 * MUST only be called from a Route Handler / Server Action (it may write a
 * cookie). Everything else keeps calling getCurrentSessionUser.
 */
export async function refreshCurrentSession(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const tokenHash = hashSessionToken(token);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, createdAt: true, expiresAt: true, revokedAt: true },
  });

  if (!session) return null;
  if (session.revokedAt) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() <= now) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: userForSessionSelect,
  });
  if (!user || user.status !== "ACTIVE") return null;
  if (user.role !== "SUPER_ADMIN" && !user.organizationId) return null;
  if (user.organization && user.organization.status !== "ACTIVE") return null;

  const withinAbsoluteCeiling =
    now - session.createdAt.getTime() < SESSION_ABSOLUTE_MAX_AGE_SECONDS * 1000;
  const burnedMoreThanHalf =
    session.expiresAt.getTime() - now < SESSION_RENEW_WHEN_REMAINING_MS;

  if (withinAbsoluteCeiling && burnedMoreThanHalf) {
    const nextExpiresAt = new Date(now + SESSION_MAX_AGE_SECONDS * 1000);
    // Best-effort: a failed renewal must never break authentication - the
    // session is still valid for the rest of its current window.
    await prisma.session
      .update({ where: { id: session.id }, data: { expiresAt: nextExpiresAt } })
      .then(() => {
        cookieStore.set(SESSION_COOKIE, token, {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          path: "/",
          maxAge: SESSION_MAX_AGE_SECONDS,
        });
      })
      .catch(() => undefined);
  }

  return mapUserToSession(user);
}

export async function requireSessionUser(
  allowedRoles?: UserRole[],
): Promise<CurrentUser> {
  const user = await getCurrentSessionUser();
  if (!user) {
    throw new AuthServiceError("Session introuvable.", 401);
  }

  return assertUserRole(user, allowedRoles);
}

export function assertUserRole(
  user: CurrentUser,
  allowedRoles?: UserRole[],
): CurrentUser {
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    throw new AuthServiceError("Acces non autorise.", 403);
  }

  return user;
}

/**
 * Revokes the current browser's session (if any) and clears its cookie.
 * The token becomes unusable immediately - even someone holding a copy of
 * the cookie cannot use it after this, since the next lookup finds
 * revokedAt set (see getCurrentSessionUser) - not merely "cookie removed
 * from this one browser" the way the previous signed-token scheme worked.
 * Sessions on other devices/browsers for the same user are untouched.
 */
export async function clearSessionCookie() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (token) {
    const tokenHash = hashSessionToken(token);
    await prisma.session
      .updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .catch((error: unknown) => {
        // Never let a DB hiccup block logout from clearing the cookie below
        // - but this is worth knowing about operationally, since it means
        // the token technically remains valid server-side until it expires
        // naturally. Never logs the token itself.
        console.error("[auth] echec de la revocation de session au logout:", error);
      });
  }

  cookieStore.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

/**
 * Revokes every active session belonging to a user - e.g. for a future
 * "compromised account" response, or to call after a future password-change
 * feature updates passwordHash (see this task's report for why that call
 * does not exist yet: there is no password-change endpoint in COMDIS today
 * to wire it into). Not currently called from anywhere; exported so it is
 * ready to be. No UI wired to it.
 */
export async function revokeAllUserSessions(userId: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

async function createSessionCookie(userId: string) {
  const token = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);

  // The raw token is never persisted - only its hash. Even a full database
  // read/leak never yields a usable token, the same way a leaked
  // passwordHash never yields a usable password.
  await prisma.session.create({
    data: { userId, tokenHash, expiresAt },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function mapUserToSession(user: {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  role: string;
  organizationId: string | null;
  driverProfile: { id: string; truckId: string | null } | null;
}): CurrentUser {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    nom: user.fullName,
    email: user.email,
    role: mapRole(user.role),
    organizationId: user.organizationId,
    driverId: user.driverProfile?.id,
    truckId: user.driverProfile?.truckId ?? undefined,
  };
}

function mapRole(role: string): UserRole {
  if (role === "SUPER_ADMIN") return "super_admin";
  if (role === "ADMIN") return "admin";
  if (role === "DEPOT_MANAGER") return "depot_manager";
  if (role === "DRIVER") return "driver";
  return "cashier";
}
