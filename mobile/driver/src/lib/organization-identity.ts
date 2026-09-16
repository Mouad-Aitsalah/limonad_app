import * as React from "react";

import { mobileFetch } from "./mobile-fetch";

export type OrganizationIdentity = { name: string; tradeName: string | null; logoUrl: string | null };

/**
 * INTÉGRATION POS SHELL - Bearer sibling of hooks/use-company-identity.tsx
 * (same GET /api/organization/identity, CORS-enabled since the offline-
 * context correction). Used only for the printed ticket header (logo) -
 * offline_context already carries organizationName for the accueil screen
 * (see lib/offline/driver-pos/context-store.ts), so this is not re-fetched
 * there. Never blocks rendering: null while loading or on any failure, same
 * as the web hook's own initial state.
 */
export function useOrganizationIdentity(token: string | null): OrganizationIdentity | null {
  const [identity, setIdentity] = React.useState<OrganizationIdentity | null>(null);

  React.useEffect(() => {
    if (!token) return;
    let active = true;
    mobileFetch<{ identity: OrganizationIdentity | null }>("/api/organization/identity", token).then(
      (outcome) => {
        if (!active) return;
        if (outcome.kind === "ok") setIdentity(outcome.data.identity);
      },
    );
    return () => {
      active = false;
    };
  }, [token]);

  return identity;
}
