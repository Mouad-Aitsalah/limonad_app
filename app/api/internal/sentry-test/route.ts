import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";

/**
 * PREVIEW-ONLY Sentry smoke test (PHASE-4Q.4A, extended for 4Q.4B delivery
 * diagnosis).
 *
 *  - On Vercel PREVIEW deployments only (`VERCEL_ENV === "preview"`):
 *    explicitly captures a fixed synthetic error (no business data, no PII),
 *    forces a transport flush, and returns HTTP 500 with a NON-SENSITIVE
 *    result body only:
 *      { test, eventCaptured, flushed, sentryEnabled, dsnConfigured, environment }
 *    The DSN value, any config object and the event payload are NEVER
 *    returned or logged here.
 *  - Anywhere else (Production, other Vercel envs, local dev, tests):
 *    responds 404 and does nothing.
 *
 * The `VERCEL_ENV` gate is set by the platform and cannot be spoofed by a
 * request. This route MUST still be deleted before this branch is merged to
 * `main` (belt-and-braces on top of the gate).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") {
    return NextResponse.json({ message: "Not found" }, { status: 404 });
  }

  const eventId = Sentry.captureException(
    new Error("SENTRY_PREVIEW_TEST_EXPLICIT - synthetic, no business data, no PII"),
  );
  const flushed = await Sentry.flush(3000);

  const options = Sentry.getClient()?.getOptions();

  return NextResponse.json(
    {
      test: "sentry-preview",
      eventCaptured: Boolean(eventId),
      flushed,
      sentryEnabled: options?.enabled ?? false,
      dsnConfigured: Boolean(options?.dsn),
      environment: options?.environment ?? null,
    },
    { status: 500 },
  );
}
