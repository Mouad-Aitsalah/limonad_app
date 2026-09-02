import { Store } from "lucide-react";

/**
 * Shown on /pos and /pos/versements when the signed-in user has no active
 * depot assigned (getCounterPosContext / resolveUserDepot throw a business
 * 409 for that). A plain, self-contained notice - no stack trace, no retry
 * loop, nothing to configure here.
 */
export function DepotRequiredNotice({ message }: { message: string }) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="max-w-md rounded-2xl border border-border bg-card px-6 py-8 text-center shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Store aria-hidden="true" className="h-6 w-6 text-muted-foreground" />
        </div>
        <h2 className="mt-4 text-base font-semibold text-foreground">
          Point de vente indisponible
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
