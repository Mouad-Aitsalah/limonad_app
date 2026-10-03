import { getCurrentBusinessDayParam } from "@/lib/business-day";
import { addDays } from "./daily-sales-series";
import { buildSnapshotRows, isMissingColumnError, type SnapshotRow } from "./purchase-forecast-snapshot";
import type { ForecastDb } from "./product-daily-sales";
import { buildSalesForecast } from "./sales-forecast";
import type { Prisma } from "@/lib/generated/prisma/client";

/**
 * Forecasting step 4 - the daily precompute, injectable (no `server-only`, no
 * session, no real `prisma` singleton - like the rest of this layer): called
 * with the real database by lib/server/purchase-forecast-cron.ts (the Vercel
 * Cron route's thin, session-free wrapper), and directly by this module's own
 * tests, exactly like every other forecasting-layer function.
 *
 * Reuses the existing engine untouched (buildSalesForecast -> sales-
 * forecast.ts -> forecast-engine.ts / product-daily-sales.ts / features /
 * baselines / random-forest-model): no ML logic is duplicated here, this
 * module only orchestrates "run the engine once per organisation, then
 * upsert its result".
 */

/** What this module needs beyond ForecastDb: listing organisations. */
export type CronDb = ForecastDb & Pick<Prisma.TransactionClient, "organization" | "purchaseForecastSnapshot">;

export type OrganizationSnapshotResult =
  | { organizationId: string; organizationCode: string; ok: true; productCount: number; durationMs: number }
  | { organizationId: string; organizationCode: string; ok: false; error: string; durationMs: number };

export type SnapshotRunSummary = {
  businessDay: string;
  organizationsTotal: number;
  organizationsSucceeded: number;
  organizationsFailed: number;
  durationMs: number;
  results: OrganizationSnapshotResult[];
};

/**
 * Upserts one organisation's snapshot rows for `businessDay`, idempotent
 * (safe to run twice the same day - the unique index on
 * [organizationId, businessDay, productId] makes each row a plain
 * create-or-replace). Sequential on purpose: this must also work with a
 * transaction client, which cannot itself open a nested transaction.
 */
async function upsertSnapshotRows(db: CronDb, rows: SnapshotRow[]): Promise<void> {
  // The two optional columns (computedAt, dailyForecast) are written when the
  // database has them. Before the migration is applied the first write fails
  // with a "column does not exist" error: the run then continues WITHOUT them
  // (same behaviour as before they existed) instead of failing the whole cron.
  let withExtras = true;
  for (const row of rows) {
    const { computedAt, dailyForecast, ...base } = row;
    const where = {
      organizationId_businessDay_productId: {
        organizationId: row.organizationId,
        businessDay: row.businessDay,
        productId: row.productId,
      },
    };
    const baseUpdate = {
      productName: row.productName,
      forecast1Day: row.forecast1Day,
      forecast3Days: row.forecast3Days,
      forecast7Days: row.forecast7Days,
      predictedQuantityRaw: row.predictedQuantityRaw,
      model: row.model,
      mae: row.mae,
      reliability: row.reliability,
      historyDays: row.historyDays,
      soldDays: row.soldDays,
    };
    if (withExtras) {
      try {
        await db.purchaseForecastSnapshot.upsert({
          where,
          create: { ...base, computedAt: computedAt ?? null, dailyForecast: dailyForecast ?? undefined },
          update: { ...baseUpdate, computedAt: computedAt ?? null, dailyForecast: dailyForecast ?? undefined },
        });
        continue;
      } catch (error) {
        if (!isMissingColumnError(error)) throw error;
        withExtras = false;
      }
    }
    await db.purchaseForecastSnapshot.upsert({ where, create: base, update: baseUpdate });
  }
}

/**
 * Runs the full engine for ONE organisation and stores its snapshot for
 * `businessDay` (asOf = the day before, exactly what getPurchaseRecommendations
 * uses by default - see its own doc comment). Never touches another
 * organisation's rows.
 */
export async function computeAndStoreSnapshot(
  db: CronDb,
  organizationId: string,
  businessDay: string = getCurrentBusinessDayParam(),
): Promise<{ productCount: number }> {
  const asOf = addDays(businessDay, -1);
  const forecast = await buildSalesForecast(db, organizationId, { asOf, horizon: 7 });
  const rows = buildSnapshotRows(organizationId, businessDay, forecast);
  await upsertSnapshotRows(db, rows);
  return { productCount: rows.length };
}

/**
 * Runs the precompute for every ACTIVE organisation (default), or for a
 * single `organizationId` when given (manual recompute - see the cron
 * route's own authorisation: this is NEVER reachable from a normal user
 * request or from the AI Assistant, only from the CRON_SECRET-protected
 * route). One organisation's failure never stops the others - see the
 * per-organisation try/catch below.
 */
export async function runPurchaseForecastSnapshot(
  db: CronDb,
  options: { organizationId?: string; businessDay?: string } = {},
): Promise<SnapshotRunSummary> {
  const businessDay = options.businessDay ?? getCurrentBusinessDayParam();
  const start = Date.now();

  const organizations = options.organizationId
    ? await db.organization.findMany({ where: { id: options.organizationId }, select: { id: true, code: true } })
    : await db.organization.findMany({ where: { status: "ACTIVE" }, select: { id: true, code: true } });

  const results: OrganizationSnapshotResult[] = [];
  for (const organization of organizations) {
    const organizationStart = Date.now();
    try {
      const { productCount } = await computeAndStoreSnapshot(db, organization.id, businessDay);
      results.push({
        organizationId: organization.id,
        organizationCode: organization.code,
        ok: true,
        productCount,
        durationMs: Date.now() - organizationStart,
      });
    } catch (error) {
      results.push({
        organizationId: organization.id,
        organizationCode: organization.code,
        ok: false,
        error: error instanceof Error ? error.message : "Erreur inconnue.",
        durationMs: Date.now() - organizationStart,
      });
    }
  }

  return {
    businessDay,
    organizationsTotal: results.length,
    organizationsSucceeded: results.filter((result) => result.ok).length,
    organizationsFailed: results.filter((result) => !result.ok).length,
    durationMs: Date.now() - start,
    results,
  };
}
