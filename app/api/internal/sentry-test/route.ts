import { NextResponse } from "next/server";

/**
 * PREVIEW-ONLY Sentry smoke test (PHASE-4Q.4A).
 *
 *  - On Vercel PREVIEW deployments only (`VERCEL_ENV === "preview"`): throws a
 *    fixed synthetic error - no business data, no PII - so we can confirm
 *    end-to-end that Sentry receives, scrubs and tags the event
 *    (`environment: preview`).
 *  - Anywhere else (Production, other Vercel envs, local dev, tests):
 *    responds 404 and does nothing.
 *
 * The `VERCEL_ENV` gate is set by the platform and cannot be spoofed by a
 * request. This route MUST still be deleted before this branch is merged to
 * `main` (belt-and-braces on top of the gate).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  if (process.env.VERCEL_ENV !== "preview") {
    return NextResponse.json({ message: "Not found" }, { status: 404 });
  }
  throw new Error("SENTRY_PREVIEW_TEST: synthetic error - no business data, no PII");
}
