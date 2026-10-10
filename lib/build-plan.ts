import { connectionTargetsKnownProduction } from "./production-endpoint";

/**
 * Build guard: decides which steps `npm run build` may run, from the build
 * environment alone. Pure (no I/O, no process access) so every environment
 * is covered by lib/build-plan.test.ts; scripts/vercel-build.ts only executes
 * the returned plan.
 *
 * Rules (anything not explicitly allowed fails or skips the migration):
 *  - Outside Vercel (local machine, CI): `next build` only. A local build never
 *    migrates whatever database the .env points to.
 *  - Vercel Production: `prisma migrate deploy` then `next build` (the
 *    behaviour the project always had).
 *  - Vercel Preview / Development: NEVER a migration against a production
 *    database. The build is refused when a connection string targets the known
 *    production endpoint, when the two strings disagree or are missing,
 *    or when APP_ENV says production. Otherwise `next build` only; the
 *    migration runs only with the explicit opt-in ALLOW_PREVIEW_MIGRATE=1.
 *  - Vercel with a missing or unknown VERCEL_ENV: refused.
 *
 * Reasons never contain a connection string, a host or any other secret.
 */

export type BuildStep = "migrate" | "build";

export type BuildPlan = { ok: true; steps: BuildStep[]; reason: string } | { ok: false; reason: string };

type BuildEnv = Record<string, string | undefined>;

/** Neon compute endpoint id of a connection string (pooled and direct hosts share it), or null. */
function endpointId(connectionString: string): string | null {
  try {
    const label = new URL(connectionString).hostname.split(".")[0] ?? "";
    return label.startsWith("ep-") ? label.replace(/-pooler$/, "") : null;
  } catch {
    return null;
  }
}

function refuse(reason: string): BuildPlan {
  return { ok: false, reason };
}

export function decideBuildPlan(env: BuildEnv): BuildPlan {
  if (env.VERCEL !== "1") {
    return { ok: true, steps: ["build"], reason: "Hors Vercel : build seul, aucune migration automatique." };
  }

  const vercelEnv = env.VERCEL_ENV;
  if (vercelEnv === "production") {
    return { ok: true, steps: ["migrate", "build"], reason: "Vercel Production : migration puis build (comportement habituel)." };
  }
  if (vercelEnv !== "preview" && vercelEnv !== "development") {
    return refuse("VERCEL_ENV est absent ou inconnu : environnement ambigu, build refusé par sécurité.");
  }

  if (env.APP_ENV === "production") {
    return refuse(`APP_ENV=production dans un environnement ${vercelEnv} : configuration contradictoire, build refusé.`);
  }
  const databaseUrl = env.DATABASE_URL;
  const directUrl = env.DIRECT_URL;
  if (!databaseUrl || !directUrl) {
    return refuse(`DATABASE_URL et DIRECT_URL doivent être définies pour ${vercelEnv} : build refusé.`);
  }
  if (connectionTargetsKnownProduction(databaseUrl) || connectionTargetsKnownProduction(directUrl)) {
    return refuse(`Une connexion ${vercelEnv} cible la base de production : build refusé, aucune migration lancée.`);
  }
  const databaseEndpoint = endpointId(databaseUrl);
  const directEndpoint = endpointId(directUrl);
  if (!databaseEndpoint || !directEndpoint) {
    return refuse(`Hôte de base de données non reconnu pour ${vercelEnv} : impossible de prouver qu'il n'est pas la production, build refusé.`);
  }
  if (databaseEndpoint !== directEndpoint) {
    return refuse(`DATABASE_URL et DIRECT_URL ne ciblent pas le même endpoint pour ${vercelEnv} : build refusé.`);
  }

  if (env.ALLOW_PREVIEW_MIGRATE === "1") {
    return {
      ok: true,
      steps: ["migrate", "build"],
      reason: `Vercel ${vercelEnv} : base vérifiée non-production, migration autorisée par ALLOW_PREVIEW_MIGRATE=1.`,
    };
  }
  return { ok: true, steps: ["build"], reason: `Vercel ${vercelEnv} : build seul, aucune migration (ALLOW_PREVIEW_MIGRATE non défini).` };
}
