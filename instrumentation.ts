/**
 * Next.js instrumentation entrypoint. Loads the right Sentry runtime config
 * and wires the App Router server error hook.
 *
 * `onRequestError` forwards errors that PROPAGATE out of a route handler or
 * server component. Most COMDIS route handlers currently catch and swallow
 * their errors (they return a 500 JSON body), so those are NOT seen here -
 * they will be reported explicitly via `lib/server/report-error.ts` as the
 * 79 catch blocks are instrumented in a later phase. For 4Q.4A only three
 * representative routes are wired.
 */
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  } else if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
