import { NextResponse } from "next/server";

import { reportUnexpected } from "@/lib/server/report-error";

/**
 * PREVIEW-ONLY end-to-end check for the BACKEND error-reporting path
 * (PHASE-4Q.4C). Unlike `/api/internal/sentry-test` (which just lets an error
 * propagate to `onRequestError`), this one proves the exact path Batch 1
 * wires everywhere:
 *
 *     server-side catch  ->  reportUnexpected()  ->  Sentry
 *                        ->  issue tagged environment=preview
 *
 * No real sale / stock / cash / tour row is created or modified - the error
 * is a fixed synthetic `Error` with no business data and no PII.
 *
 * 404 anywhere except a Vercel PREVIEW deployment. The `VERCEL_ENV` gate is
 * set by the platform and cannot be spoofed by a request. Delete together
 * with `/api/internal/sentry-test` before this branch is merged to `main`.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") {
    return NextResponse.json({ message: "Not found" }, { status: 404 });
  }

  try {
    throw new Error(
      "REPORT_ERROR_PREVIEW_TEST: synthetic backend failure - no business data, no PII",
    );
  } catch (error) {
    reportUnexpected(error, {
      route: "GET /api/internal/report-error-test",
      area: "internal",
      op: "previewSelfTest",
    });
    return NextResponse.json(
      { test: "report-error-preview", reported: true },
      { status: 500 },
    );
  }
}
