"use client";

import * as React from "react";

export type CompanyIdentity = {
  name: string;
  tradeName: string | null;
  logoUrl: string | null;
};

/**
 * The current organisation's name + logo, fetched once from
 * GET /api/organization/identity and cached at module scope so navigating
 * between pages never refetches. Used by the sidebar and the sales ticket.
 *
 * The logo can be a few hundred KB (a base64 data URL), so it is
 * deliberately NOT put on the auth session payload - this dedicated,
 * lazily-fetched cache keeps it off every session poll.
 */

let cache: CompanyIdentity | null = null;
let inflight: Promise<CompanyIdentity | null> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

async function loadIdentity(): Promise<CompanyIdentity | null> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const response = await fetch("/api/organization/identity", { cache: "no-store" });
      if (!response.ok) return null;
      const body = (await response.json()) as { identity?: CompanyIdentity };
      if (body.identity) {
        cache = body.identity;
        notify();
      }
      return cache;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Replace (or clear, with no argument) the cached identity - call after a
 * successful logo change, and on logout so the next user never briefly sees
 * the previous organisation's logo.
 */
export function resetCompanyIdentityCache(next?: CompanyIdentity | null) {
  cache = next ?? null;
  inflight = null;
  notify();
}

export function useCompanyIdentity(): {
  identity: CompanyIdentity | null;
  refresh: () => void;
} {
  const [identity, setIdentity] = React.useState<CompanyIdentity | null>(cache);

  React.useEffect(() => {
    const listener = () => setIdentity(cache);
    listeners.add(listener);
    void loadIdentity().then((value) => {
      if (value) setIdentity(value);
    });
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const refresh = React.useCallback(() => {
    cache = null;
    inflight = null;
    void loadIdentity();
  }, []);

  return { identity, refresh };
}
