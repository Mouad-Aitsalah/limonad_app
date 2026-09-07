import { loadEnvConfig } from "@next/env";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient, Prisma } from "../lib/generated/prisma/client";

loadEnvConfig(process.cwd());
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

/**
 * Backfill. Assigns a real commercial number (saleNumber / saleYear) to the
 * legacy pending-sale drafts that never got one - and ONLY those.
 *
 * STRICT SELECTION (belt AND braces):
 *   invoiceNumber LIKE 'BR-%'   AND   (saleNumber IS NULL OR saleYear IS NULL)
 * A non-BR row is NEVER touched, even if its saleNumber/saleYear is null - the
 * query filters it out, and a runtime guard inside the loop refuses to write
 * to any row whose invoiceNumber does not start with "BR-".
 *
 * Uses the real DocumentType.Sale = "SALE" sequence, scoped per year, via the
 * exact same atomic `INSERT ... ON CONFLICT DO UPDATE currentValue + 1
 * RETURNING` that reserveDocumentSequence() runs
 * (lib/server/document-sequence.ts) - inside ONE Serializable transaction.
 * Never renumbers an already-numbered sale. Touches nothing but
 * Sale.saleNumber / Sale.saleYear.
 *
 *   npx tsx scripts/backfill-legacy-sale-numbers.ts            -> dry run (no writes)
 *   npx tsx scripts/backfill-legacy-sale-numbers.ts --apply    -> perform the backfill
 */
const APPLY = process.argv.includes("--apply");
const SALE_DOC_TYPE = "SALE"; // = DocumentType.Sale
const BR_PREFIX = "BR-";

async function reserveNextSaleNumber(
  tx: Prisma.TransactionClient,
  organizationId: string,
  year: number,
): Promise<number> {
  const rows = await tx.$queryRaw<{ currentValue: number }[]>(Prisma.sql`
    INSERT INTO "DocumentSequence" ("id", "organizationId", "documentType", "scopeKey", "currentValue", "updatedAt")
    VALUES (md5(random()::text || clock_timestamp()::text), ${organizationId}, ${SALE_DOC_TYPE}, ${String(year)}, 1, NOW())
    ON CONFLICT ("organizationId", "documentType", "scopeKey")
    DO UPDATE SET "currentValue" = "DocumentSequence"."currentValue" + 1, "updatedAt" = NOW()
    RETURNING "currentValue"
  `);
  return Number(rows[0].currentValue);
}

async function main() {
  const legacy = await prisma.sale.findMany({
    where: {
      invoiceNumber: { startsWith: BR_PREFIX },
      OR: [{ saleNumber: null }, { saleYear: null }],
    },
    select: { id: true, organizationId: true, createdAt: true, invoiceNumber: true, status: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  // Runtime guard - the query already filters, this refuses to proceed if a
  // non-BR row ever slipped through a future edit of the where clause.
  const intruder = legacy.find((s) => !s.invoiceNumber.startsWith(BR_PREFIX));
  if (intruder) {
    throw new Error(
      `Refusing to run: a non-BR sale is in the selection (${intruder.invoiceNumber}, id ${intruder.id}).`,
    );
  }

  // For information: sales that are missing a number but are NOT BR - the
  // script will never touch these.
  const nonBrMissing = await prisma.sale.count({
    where: {
      NOT: { invoiceNumber: { startsWith: BR_PREFIX } },
      OR: [{ saleNumber: null }, { saleYear: null }],
    },
  });
  console.log(
    `Selection: invoiceNumber LIKE 'BR-%' AND (saleNumber IS NULL OR saleYear IS NULL)`,
  );
  console.log(
    `Non-BR sales with an incomplete number (NOT touched by this script): ${nonBrMissing}`,
  );

  if (legacy.length === 0) {
    console.log("Nothing to backfill - no eligible BR legacy sale.");
    return;
  }

  console.log(`${legacy.length} eligible BR sale(s) to number.  MODE: ${APPLY ? "APPLY" : "DRY RUN"}\n`);

  if (!APPLY) {
    const counters = new Map<string, number>();
    for (const s of legacy) {
      const year = s.createdAt.getFullYear();
      const key = `${s.organizationId}|${year}`;
      if (!counters.has(key)) {
        const seq = await prisma.$queryRawUnsafe<{ currentValue: number }[]>(
          `SELECT "currentValue" FROM "DocumentSequence"
            WHERE "organizationId" = $1 AND "documentType" = 'SALE' AND "scopeKey" = $2`,
          s.organizationId,
          String(year),
        );
        const maxRow = await prisma.sale.aggregate({
          where: { organizationId: s.organizationId, saleYear: year },
          _max: { saleNumber: true },
        });
        counters.set(
          key,
          Math.max(Number(seq[0]?.currentValue ?? 0), maxRow._max.saleNumber ?? 0),
        );
      }
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      console.log(`  ${s.invoiceNumber}  (${s.status})  ->  ${next}/${year}   [id ${s.id}]`);
    }
    console.log("\n(dry run - no rows changed; re-run with --apply)");
    return;
  }

  const result = await prisma.$transaction(
    async (tx) => {
      const healed = new Set<string>();
      const assignments: {
        id: string;
        invoiceNumber: string;
        saleNumber: number;
        saleYear: number;
      }[] = [];

      for (const s of legacy) {
        if (!s.invoiceNumber.startsWith(BR_PREFIX)) {
          throw new Error(`Guard: refusing to number a non-BR sale (${s.invoiceNumber}).`);
        }
        const year = s.createdAt.getFullYear();
        const groupKey = `${s.organizationId}|${year}`;

        // Defensive heal: never let the sequence sit below the highest number
        // already issued for this (org, year). GREATEST => no-op when ahead.
        if (!healed.has(groupKey)) {
          const maxRow = await tx.sale.aggregate({
            where: { organizationId: s.organizationId, saleYear: year },
            _max: { saleNumber: true },
          });
          const maxExisting = maxRow._max.saleNumber ?? 0;
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO "DocumentSequence" ("id","organizationId","documentType","scopeKey","currentValue","updatedAt")
            VALUES (md5(random()::text || clock_timestamp()::text), ${s.organizationId}, ${SALE_DOC_TYPE}, ${String(year)}, ${maxExisting}, NOW())
            ON CONFLICT ("organizationId","documentType","scopeKey")
            DO UPDATE SET "currentValue" = GREATEST("DocumentSequence"."currentValue", ${maxExisting}), "updatedAt" = NOW()
          `);
          healed.add(groupKey);
        }

        const nextNumber = await reserveNextSaleNumber(tx, s.organizationId, year);
        await tx.sale.update({
          where: { id: s.id },
          data: { saleNumber: nextNumber, saleYear: year },
        });
        assignments.push({
          id: s.id,
          invoiceNumber: s.invoiceNumber,
          saleNumber: nextNumber,
          saleYear: year,
        });
      }

      return assignments;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60000 },
  );

  for (const a of result) {
    console.log(`  ${a.invoiceNumber}  ->  ${a.saleNumber}/${a.saleYear}   [id ${a.id}]`);
  }
  console.log(`\nAPPLIED - ${result.length} sale(s) numbered.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
