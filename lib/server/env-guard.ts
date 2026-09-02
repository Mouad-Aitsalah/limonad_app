import "server-only";

/**
 * Phase 4B: reusable guard against ever running a seed/bench/fixture/
 * destructive script against the production database - two INDEPENDENT
 * signals, either one alone is enough to refuse:
 *
 *  1. APP_ENV=production - the explicit, deliberate flag. Set ONLY in
 *     Vercel's Production environment variables; never set locally.
 *  2. DATABASE_URL/DIRECT_URL host matching the known production Neon
 *     endpoint (KNOWN_PRODUCTION_ENDPOINT_SUBSTRING below) - protects
 *     against the case APP_ENV is unset/misconfigured somewhere (a shell
 *     that forgot to export it, a CI job with a stale env) while the
 *     connection string still targets real production data. This is the
 *     same fail-closed philosophy prisma/seed.ts already uses for
 *     NODE_ENV/ALLOW_DEMO_SEED - checked independently, not merged into one
 *     condition, so each failure mode has its own unambiguous message.
 *
 * Never hardcodes a password or a full connection string - only the
 * production endpoint's hostname fragment, which identifies a compute
 * endpoint but grants no access by itself.
 */
const KNOWN_PRODUCTION_ENDPOINT_SUBSTRING = "ep-old-block-aebwqtri";

function connectionTargetsKnownProduction(value: string | undefined): boolean {
  return Boolean(value && value.includes(KNOWN_PRODUCTION_ENDPOINT_SUBSTRING));
}

/** True if either guard signal currently indicates production - see this
 * module's doc comment. Safe to call outside a script context too (e.g. to
 * gate a UI affordance), but assertNotProduction below is the primary API
 * for scripts. */
export function isProductionEnvironment(): boolean {
  return (
    process.env.APP_ENV === "production" ||
    connectionTargetsKnownProduction(process.env.DATABASE_URL) ||
    connectionTargetsKnownProduction(process.env.DIRECT_URL)
  );
}

/**
 * Call at the very top of any seed/bench/fixture/destructive script,
 * before any database call. Throws immediately if either guard signal
 * indicates production - see this module's doc comment for why there are
 * two independent checks rather than one combined condition.
 *
 * `context` is a short, human-readable label for what was refused (e.g.
 * "prisma/seed.ts", "scratchpad-bench-products.ts") - it only shapes the
 * error message, callers don't need to keep it unique or structured.
 */
export function assertNotProduction(context: string): void {
  if (process.env.APP_ENV === "production") {
    throw new Error(
      `[env-guard] Refuse d'executer "${context}" : APP_ENV=production. ` +
        "Ce script ne doit jamais etre execute contre la production, quelle " +
        "que soit la valeur des autres variables. Aucune donnee n'a ete touchee.",
    );
  }

  if (connectionTargetsKnownProduction(process.env.DATABASE_URL)) {
    throw new Error(
      `[env-guard] Refuse d'executer "${context}" : DATABASE_URL pointe vers ` +
        `l'endpoint de production connu (${KNOWN_PRODUCTION_ENDPOINT_SUBSTRING}), ` +
        "meme si APP_ENV ne vaut pas \"production\". Aucune donnee n'a ete touchee.",
    );
  }

  if (connectionTargetsKnownProduction(process.env.DIRECT_URL)) {
    throw new Error(
      `[env-guard] Refuse d'executer "${context}" : DIRECT_URL pointe vers ` +
        `l'endpoint de production connu (${KNOWN_PRODUCTION_ENDPOINT_SUBSTRING}), ` +
        "meme si APP_ENV ne vaut pas \"production\". Aucune donnee n'a ete touchee.",
    );
  }
}
