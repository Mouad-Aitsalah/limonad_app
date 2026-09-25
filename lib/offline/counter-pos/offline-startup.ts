"use client";

/**
 * COUNTER POS - the decision taken when the app starts WITHOUT Internet.
 *
 * Inputs are only what is stored locally: the offline session record and the
 * mirror of that session's own organization + user. There is deliberately no
 * parameter to pass a user or an organization: the identity can only come from
 * the record written after a real online login, and the database that is
 * opened is the one named by that record - another organization's data can
 * never become the current context.
 */

import type { CounterPosContextDto } from "@/types/operations-dto";

import { readOfflineSession, type OfflineSession } from "./offline-session";
import { loadCachedCounterPosContext } from "./pos-data-source";
import type { CounterPosScope } from "./schema";

export type OfflineStartupResult =
  | {
      state: "READY";
      session: OfflineSession;
      scope: CounterPosScope;
      context: CounterPosContextDto;
      /** When the catalogue / customers were last mirrored from the server. */
      syncedAt: string;
    }
  /** The first login (or a new one) needs Internet. */
  | { state: "LOGIN_REQUIRED"; reason: "MISSING" | "EXPIRED" | "INVALID" | "STORAGE_ERROR" }
  /** Signed in before, but the POS was never opened online: nothing to sell from. */
  | { state: "DATA_MISSING"; session: OfflineSession };

export type OfflineStartupDeps = {
  now?: Date;
};

export async function resolveOfflineStartup(
  deps: OfflineStartupDeps = {},
): Promise<OfflineStartupResult> {
  const read = await readOfflineSession({ now: deps.now });
  if (read.status !== "VALID") return { state: "LOGIN_REQUIRED", reason: read.status };

  const { session } = read;
  const scope: CounterPosScope = { organizationId: session.organizationId, userId: session.userId };
  const cached = await loadCachedCounterPosContext(scope);
  if (!cached.ok) return { state: "DATA_MISSING", session };

  // Belt and braces: the mirrored context must be this very user's.
  if (cached.context.user.id !== session.userId) return { state: "DATA_MISSING", session };

  return { state: "READY", session, scope, context: cached.context, syncedAt: cached.syncedAt };
}
