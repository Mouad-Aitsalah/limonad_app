"use client";

/**
 * COUNTER POS - the "offline session bootstrap".
 *
 * Question answered: "this PC has no Internet at start-up; may it open the
 * counter POS, and for WHOM?". The server cookie cannot be checked offline
 * (it is an opaque token, revocable server side), so the answer comes from one
 * small record written ONLY right after a real, server-confirmed session:
 *
 *   { userId, organizationId, role, name, issuedAt, expiresAt, dataReadyAt }
 *
 * Deliberately:
 *   - ONE record per PC ("current"). A new online login replaces it. There is
 *     no list of users to pick from and no way to choose an identity offline.
 *   - No password, no token, no e-mail, no PIN. Only what is needed to know
 *     who is selling and with which rights.
 *   - Roles: admin and cashier only. Nothing else may start the POS offline.
 *   - Time boxed: OFFLINE_SESSION_TTL_MS (mirrors the 20 h sliding server
 *     cookie), renewed at each online confirmation, deleted at logout and when
 *     the server says the session is over. A record whose dates are
 *     inconsistent (tampered: expiry beyond the TTL, issued in the future) is
 *     INVALID, never trusted.
 *   - It authorizes nothing on the server: a sale made offline is still
 *     re-authenticated with the real session at synchronisation
 *     (POST /api/sales/sync refuses another user or organization).
 *
 * It lives in its OWN tiny database because at start-up nothing tells us which
 * organization's database to open - that answer is what this record gives.
 */

import Dexie, { type Table } from "dexie";

import type { CurrentUser } from "@/types/auth";

export const OFFLINE_SESSION_DB_NAME = "comdis-counter-pos-session";
export const OFFLINE_SESSION_KEY = "current";
/** Mirrors the sliding 20 h server session; renewed on every online confirmation. */
export const OFFLINE_SESSION_TTL_MS = 20 * 60 * 60 * 1000;
/** Tolerated clock skew for an `issuedAt` slightly in the future. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

export const OFFLINE_SESSION_ROLES = ["admin", "cashier"] as const;
export type OfflineSessionRole = (typeof OFFLINE_SESSION_ROLES)[number];

export type OfflineSession = {
  userId: string;
  organizationId: string;
  role: OfflineSessionRole;
  /** Display name only. */
  name: string;
  firstName?: string;
  lastName?: string;
  issuedAt: string;
  expiresAt: string;
  /** When the POS data (catalogue, customers) was last mirrored for this user. */
  dataReadyAt: string;
};

type OfflineSessionRow = OfflineSession & { key: typeof OFFLINE_SESSION_KEY };

class OfflineSessionDatabase extends Dexie {
  identity!: Table<OfflineSessionRow, string>;

  constructor() {
    super(OFFLINE_SESSION_DB_NAME);
    this.version(1).stores({ identity: "key" });
  }
}

let database: OfflineSessionDatabase | null = null;

function getDatabase(): OfflineSessionDatabase | null {
  if (typeof indexedDB === "undefined") return null;
  if (!database) database = new OfflineSessionDatabase();
  return database;
}

/** Closes the connection (tests simulate "close the app" with it). */
export function closeOfflineSessionDatabase(): void {
  database?.close();
  database = null;
}

export function isOfflineSessionRole(role: unknown): role is OfflineSessionRole {
  return typeof role === "string" && (OFFLINE_SESSION_ROLES as readonly string[]).includes(role);
}

export type SaveOfflineSessionResult =
  | { ok: true; session: OfflineSession }
  | { ok: false; reason: "ROLE_NOT_ALLOWED" | "NO_ORGANIZATION" | "INVALID_USER" | "STORAGE_ERROR" };

/**
 * Records (or renews) the offline session. Call it ONLY with a user the
 * server just confirmed (login response, or /api/auth/session), never with
 * data that came from local storage.
 */
export async function saveOfflineSession(
  user: Pick<CurrentUser, "id" | "role" | "organizationId" | "nom" | "firstName" | "lastName">,
  options: { now?: Date; ttlMs?: number } = {},
): Promise<SaveOfflineSessionResult> {
  if (!user || typeof user.id !== "string" || user.id === "") return { ok: false, reason: "INVALID_USER" };
  if (!isOfflineSessionRole(user.role)) return { ok: false, reason: "ROLE_NOT_ALLOWED" };
  if (typeof user.organizationId !== "string" || user.organizationId === "") {
    return { ok: false, reason: "NO_ORGANIZATION" };
  }
  const db = getDatabase();
  if (!db) return { ok: false, reason: "STORAGE_ERROR" };

  const now = options.now ?? new Date();
  const ttl = Math.min(options.ttlMs ?? OFFLINE_SESSION_TTL_MS, OFFLINE_SESSION_TTL_MS);
  try {
    const session = await db.transaction("rw", db.identity, async () => {
      const previous = await db.identity.get(OFFLINE_SESSION_KEY);
      const sameIdentity =
        previous && previous.userId === user.id && previous.organizationId === user.organizationId;
      const row: OfflineSessionRow = {
        key: OFFLINE_SESSION_KEY,
        userId: user.id,
        organizationId: user.organizationId as string,
        role: user.role as OfflineSessionRole,
        name: user.nom ?? "",
        ...(user.firstName ? { firstName: user.firstName } : {}),
        ...(user.lastName ? { lastName: user.lastName } : {}),
        issuedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ttl).toISOString(),
        // A different person / organization starts with NO data readiness: the
        // previous user's mirror does not make this one ready.
        dataReadyAt: sameIdentity ? previous.dataReadyAt : "",
      };
      await db.identity.put(row);
      return row;
    });
    return { ok: true, session: stripKey(session) };
  } catch {
    return { ok: false, reason: "STORAGE_ERROR" };
  }
}

/** The POS data of THIS session's user has just been mirrored locally. */
export async function markOfflineDataReady(
  identity: { userId: string; organizationId: string },
  options: { now?: Date } = {},
): Promise<boolean> {
  const db = getDatabase();
  if (!db) return false;
  try {
    return await db.transaction("rw", db.identity, async () => {
      const row = await db.identity.get(OFFLINE_SESSION_KEY);
      if (!row || row.userId !== identity.userId || row.organizationId !== identity.organizationId) return false;
      await db.identity.put({ ...row, dataReadyAt: (options.now ?? new Date()).toISOString() });
      return true;
    });
  } catch {
    return false;
  }
}

export type ReadOfflineSessionResult =
  | { status: "VALID"; session: OfflineSession }
  | { status: "MISSING" | "EXPIRED" | "INVALID" | "STORAGE_ERROR" };

function parseIso(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

export async function readOfflineSession(
  options: { now?: Date } = {},
): Promise<ReadOfflineSessionResult> {
  const db = getDatabase();
  if (!db) return { status: "STORAGE_ERROR" };
  let row: OfflineSessionRow | undefined;
  try {
    row = await db.identity.get(OFFLINE_SESSION_KEY);
  } catch {
    return { status: "STORAGE_ERROR" };
  }
  if (!row) return { status: "MISSING" };

  const issued = parseIso(row.issuedAt);
  const expires = parseIso(row.expiresAt);
  const now = (options.now ?? new Date()).getTime();
  if (
    typeof row.userId !== "string" || row.userId === "" ||
    typeof row.organizationId !== "string" || row.organizationId === "" ||
    !isOfflineSessionRole(row.role) ||
    issued === null || expires === null ||
    expires <= issued ||
    // An expiry further away than the TTL allows was not written by this module.
    expires - issued > OFFLINE_SESSION_TTL_MS ||
    issued > now + CLOCK_SKEW_MS
  ) {
    return { status: "INVALID" };
  }
  if (expires <= now) return { status: "EXPIRED" };
  return { status: "VALID", session: stripKey(row) };
}

/** The organization named by the stored record, even if expired or invalid -
 *  only used to know WHICH mirrored data to purge at logout, never to sign in. */
export async function peekOfflineSessionOrganizationId(): Promise<string | null> {
  const db = getDatabase();
  if (!db) return null;
  try {
    const row = await db.identity.get(OFFLINE_SESSION_KEY);
    return typeof row?.organizationId === "string" && row.organizationId !== "" ? row.organizationId : null;
  } catch {
    return null;
  }
}

/** Deletes the offline identity: no new offline start until an online login. */
export async function clearOfflineSession(): Promise<boolean> {
  const db = getDatabase();
  if (!db) return false;
  try {
    await db.identity.delete(OFFLINE_SESSION_KEY);
    return true;
  } catch {
    return false;
  }
}

function stripKey(row: OfflineSessionRow): OfflineSession {
  const { key: _key, ...session } = row;
  void _key;
  return session;
}

/** The identity the offline POS runs as - exactly the stored role, never more. */
export function offlineSessionToCurrentUser(session: OfflineSession): CurrentUser {
  return {
    id: session.userId,
    nom: session.name,
    ...(session.firstName ? { firstName: session.firstName } : {}),
    ...(session.lastName ? { lastName: session.lastName } : {}),
    email: "",
    role: session.role,
    organizationId: session.organizationId,
  };
}
