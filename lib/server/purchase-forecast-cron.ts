import { NextResponse } from "next/server";
import { z } from "zod";

import type { SnapshotRunSummary } from "@/lib/forecasting/purchase-forecast-run";

/**
 * Forecasting step 4 - daily precompute of PurchaseForecastSnapshot, request
 * logic for app/api/cron/purchase-forecast/route.ts, with its collaborators
 * injected (same pattern as lib/server/assistant-transcribe.ts) so it can be
 * tested without Next, Prisma or a real secret. The route file wires the real
 * ones: `run` bound to the real `prisma` singleton
 * (lib/forecasting/purchase-forecast-run.ts's runPurchaseForecastSnapshot),
 * `cronSecret` read from `process.env.CRON_SECRET`.
 *
 * NEVER authenticated by a user session: Vercel Cron has none. Both GET (what
 * Vercel Cron sends) and POST (manual trigger) require the exact same secret,
 * checked BEFORE the body is even read, BEFORE `run` is ever called - an
 * unset secret always refuses, it is never treated as "open". No
 * `organizationId` is ever accepted from anything but this server-to-server
 * call.
 */

export type CronDeps = {
  cronSecret: string | undefined;
  run: (options: { organizationId?: string; businessDay?: string }) => Promise<SnapshotRunSummary>;
};

function isAuthorized(request: Request, cronSecret: string | undefined): boolean {
  if (!cronSecret) return false;
  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

const manualRecomputeSchema = z
  .object({
    /**
     * Recompute only this organisation instead of every ACTIVE one - "5.
     * recalculer une organisation sans affecter les autres". Only reachable
     * here, server-to-server with CRON_SECRET - never from a user request or
     * from the AI Assistant (getPurchaseRecommendations never accepts it).
     */
    organizationId: z.string().trim().min(1).max(64).optional(),
    /** Business day to (re)compute, "YYYY-MM-DD". Default: today's. */
    businessDay: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .strict();

/** Vercel Cron's own call: no body, every ACTIVE organisation, today's business day. */
export async function handleCronGet(request: Request, deps: CronDeps): Promise<Response> {
  if (!isAuthorized(request, deps.cronSecret)) {
    return NextResponse.json({ message: "Non autorisé." }, { status: 401 });
  }
  try {
    return NextResponse.json(await deps.run({}));
  } catch {
    return NextResponse.json({ message: "Échec du précalcul." }, { status: 500 });
  }
}

/** Manual recompute (all organisations, or one via `organizationId`) - same secret, same guarantees. */
export async function handleCronPost(request: Request, deps: CronDeps): Promise<Response> {
  if (!isAuthorized(request, deps.cronSecret)) {
    return NextResponse.json({ message: "Non autorisé." }, { status: 403 });
  }
  const parsed = manualRecomputeSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ message: "Paramètres invalides." }, { status: 400 });
  }
  try {
    return NextResponse.json(await deps.run(parsed.data));
  } catch {
    return NextResponse.json({ message: "Échec du précalcul." }, { status: 500 });
  }
}
