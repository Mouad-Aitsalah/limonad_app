import { loadEnvConfig } from "@next/env";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../lib/generated/prisma/client";

loadEnvConfig(process.cwd());
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

/**
 * READ-ONLY audit. Modifies NOTHING.
 *
 * Splits the sales that have no commercial number
 * (saleNumber IS NULL OR saleYear IS NULL) into two clearly separate groups:
 *
 *   GROUP 1 - invoiceNumber starts with "BR-"  -> ELIGIBLE for the backfill
 *             (scripts/backfill-legacy-sale-numbers.ts).
 *   GROUP 2 - any other invoiceNumber (VC-…, legacy, …) -> NOT ELIGIBLE.
 *             SIGNAL ONLY. The backfill will NEVER touch these rows.
 */
const BR_PREFIX = "BR-";

type Row = {
  id: string;
  organizationId: string;
  createdAt: Date;
  invoiceNumber: string;
  saleNumber: number | null;
  saleYear: number | null;
  status: string;
  origin: string;
  totalTTC: { toString(): string };
  customer: { code: string; name: string } | null;
};

async function main() {
  const missing = (await prisma.sale.findMany({
    where: { OR: [{ saleNumber: null }, { saleYear: null }] },
    select: {
      id: true,
      organizationId: true,
      createdAt: true,
      invoiceNumber: true,
      saleNumber: true,
      saleYear: true,
      status: true,
      origin: true,
      totalTTC: true,
      customer: { select: { code: true, name: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  })) as Row[];

  const eligible = missing.filter((s) => s.invoiceNumber.startsWith(BR_PREFIX));
  const signalOnly = missing.filter((s) => !s.invoiceNumber.startsWith(BR_PREFIX));

  console.log(`Sales without a commercial number (saleNumber/saleYear NULL): ${missing.length}`);
  console.log(`  GROUP 1  ELIGIBLE (invoiceNumber LIKE 'BR-%'): ${eligible.length}`);
  console.log(`  GROUP 2  NOT ELIGIBLE - SIGNAL ONLY:           ${signalOnly.length}`);

  const fmt = (s: Row) => ({
    id: s.id,
    createdAt: s.createdAt.toISOString(),
    invoiceNumber: s.invoiceNumber,
    saleNumber: s.saleNumber,
    saleYear: s.saleYear,
    status: s.status,
    origin: s.origin,
    totalTTC: s.totalTTC.toString(),
    customer: s.customer ? `${s.customer.code} ${s.customer.name}` : null,
    organizationId: s.organizationId,
  });

  console.log("\n=== GROUP 1 - legacy BR sales ELIGIBLE for backfill ===");
  console.log(JSON.stringify(eligible.map(fmt), null, 2));

  console.log(
    "\n=== GROUP 2 - non-BR sales with incomplete saleNumber/saleYear - SIGNAL ONLY (NEVER modified by the backfill) ===",
  );
  console.log(
    signalOnly.length ? JSON.stringify(signalOnly.map(fmt), null, 2) : "(none)",
  );

  // Backfill groups (organizationId, year) - computed over GROUP 1 ONLY.
  const groups = new Map<string, { org: string; year: number; count: number }>();
  for (const s of eligible) {
    const year = s.createdAt.getFullYear();
    const key = `${s.organizationId}|${year}`;
    const g = groups.get(key) ?? { org: s.organizationId, year, count: 0 };
    g.count += 1;
    groups.set(key, g);
  }

  console.log(
    "\n=== backfill groups (organizationId, year) + current sequence state - GROUP 1 only ===",
  );
  for (const g of groups.values()) {
    const maxRow = await prisma.sale.aggregate({
      where: { organizationId: g.org, saleYear: g.year },
      _max: { saleNumber: true },
    });
    const seq = await prisma.$queryRawUnsafe<{ currentValue: number }[]>(
      `SELECT "currentValue" FROM "DocumentSequence"
        WHERE "organizationId" = $1 AND "documentType" = 'SALE' AND "scopeKey" = $2`,
      g.org,
      String(g.year),
    );
    console.log(
      JSON.stringify({
        organizationId: g.org,
        year: g.year,
        eligibleToNumber: g.count,
        maxExistingSaleNumber: maxRow._max.saleNumber,
        documentSequenceCurrentValue: seq[0]?.currentValue ?? null,
        sequenceBehindMax: (seq[0]?.currentValue ?? 0) < (maxRow._max.saleNumber ?? 0),
      }),
    );
  }

  // Sanity: any existing duplicate (org, year, number)?
  const dups = await prisma.$queryRawUnsafe<
    { organizationId: string; saleYear: number; saleNumber: number; n: bigint }[]
  >(`
    SELECT "organizationId", "saleYear", "saleNumber", count(*) AS n
      FROM "Sale"
     WHERE "saleNumber" IS NOT NULL AND "saleYear" IS NOT NULL
     GROUP BY "organizationId", "saleYear", "saleNumber"
    HAVING count(*) > 1
  `);
  console.log(
    `\nexisting (org, year, number) duplicates: ${dups.length}`,
    dups.length ? JSON.stringify(dups) : "",
  );

  console.log(
    `\nSUMMARY: the backfill would touch exactly ${eligible.length} sale(s), ALL with invoiceNumber LIKE 'BR-%'. GROUP 2 (${signalOnly.length}) is signalled only and never modified.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
