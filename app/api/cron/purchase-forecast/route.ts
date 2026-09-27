import { runPurchaseForecastSnapshot } from "@/lib/forecasting/purchase-forecast-run";
import { handleCronGet, handleCronPost } from "@/lib/server/purchase-forecast-cron";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// One organisation's full forecast takes ~10s; several organisations run
// sequentially (see runPurchaseForecastSnapshot) - well over the platform
// default, so this needs the longest duration the plan allows.
export const maxDuration = 300;

/**
 * Forecasting step 4 - daily precompute of PurchaseForecastSnapshot.
 *
 * Vercel Cron calls this (see vercel.json) once a day, shortly after the
 * COMDIS business day rolls over (02h00 Casablanca - lib/business-day.ts).
 * The actual request logic (secret check, body parsing) lives in
 * lib/server/purchase-forecast-cron.ts, with its collaborators injected here
 * so it can be tested without Next, Prisma or a real secret.
 */
export async function GET(request: Request) {
  return handleCronGet(request, {
    cronSecret: process.env.CRON_SECRET,
    run: (options) => runPurchaseForecastSnapshot(prisma, options),
  });
}

export async function POST(request: Request) {
  return handleCronPost(request, {
    cronSecret: process.env.CRON_SECRET,
    run: (options) => runPurchaseForecastSnapshot(prisma, options),
  });
}
