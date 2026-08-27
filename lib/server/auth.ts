import "server-only";

import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import type { CurrentUser, UserRole } from "@/types/auth";

const SESSION_COOKIE = "comdis.session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

type SessionPayload = {
  user: CurrentUser;
  exp: number;
};

export class AuthServiceError extends Error {
  constructor(
    message: string,
    public status = 401,
  ) {
    super(message);
  }
}

export async function loginWithPassword(email: string, password: string) {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      fullName: true,
      email: true,
      passwordHash: true,
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
    },
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

  const sessionUser = mapUserToSession(user);
  await setSessionCookie(sessionUser);
  return sessionUser;
}

export async function getCurrentSessionUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const payload = verifySessionToken(token);
  if (!payload || payload.exp < Date.now()) return null;

  const user = await prisma.user.findUnique({
    where: { id: payload.user.id },
    select: {
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
    },
  });

  if (!user || user.status !== "ACTIVE") return null;
  if (user.role !== "SUPER_ADMIN" && !user.organizationId) return null;
  if (user.organization && user.organization.status !== "ACTIVE") return null;
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

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

async function setSessionCookie(user: CurrentUser) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, signSessionPayload({ user, exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000 }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
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

function signSessionPayload(payload: SessionPayload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${signature(body)}`;
}

function verifySessionToken(token: string): SessionPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = signature(body);
  const actualBuffer = Buffer.from(sig);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
  } catch {
    return null;
  }
}

function signature(value: string) {
  return createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

function sessionSecret() {
  return process.env.AUTH_SECRET ?? process.env.DATABASE_URL ?? "comdis-local-dev-secret";
}
