/**
 * Sentry environment / release resolution, shared by all three init points
 * (client, server, edge). See PHASE-4Q.4A.
 *
 *  - environment: derived from `VERCEL_ENV` (server) or, when built with it,
 *    `NEXT_PUBLIC_VERCEL_ENV` (client). Falls back to NODE_ENV. NEVER APP_ENV.
 *  - release: the Vercel commit SHA when available.
 *  - enabled: only on Vercel Production or Preview deployments, and only when
 *    a DSN is configured. Off in local development by default.
 */

export function resolveSentryEnvironment(): "production" | "preview" | "development" {
  const value = process.env.VERCEL_ENV ?? process.env.NEXT_PUBLIC_VERCEL_ENV;
  if (value === "production" || value === "preview" || value === "development") {
    return value;
  }
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

export function resolveSentryRelease(): string | undefined {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ??
    undefined
  );
}

export function isSentryEnabled(dsn: string | undefined): boolean {
  if (!dsn) return false;
  const environment = resolveSentryEnvironment();
  return environment === "production" || environment === "preview";
}

/**
 * PHASE-4Q.4B TEMPORARY DIAGNOSTIC — Preview only.
 *
 * Prints, at most once per runtime, whether a DSN reached this build and
 * whether Sentry resolves to `enabled`, so we can tell from the Vercel logs
 * why a Preview event is not arriving. NON-SENSITIVE by construction: only
 * booleans and the coarse environment string are logged — never the DSN
 * value, never any config object. Remove once Preview delivery is confirmed.
 */
let previewDiagnosticsLogged = false;

export function logSentryPreviewDiagnostics(dsn: string | undefined): void {
  if (previewDiagnosticsLogged) return;
  if (resolveSentryEnvironment() !== "preview") return;
  previewDiagnosticsLogged = true;
  console.log(
    "[sentry-4Q.4B]",
    JSON.stringify({
      runtime: process.env.NEXT_RUNTIME ?? "browser",
      vercelEnv: process.env.VERCEL_ENV ?? process.env.NEXT_PUBLIC_VERCEL_ENV ?? null,
      dsnPresent: Boolean(dsn),
      sentryEnabled: isSentryEnabled(dsn),
      environment: resolveSentryEnvironment(),
      releasePresent: Boolean(resolveSentryRelease()),
    }),
  );
}
