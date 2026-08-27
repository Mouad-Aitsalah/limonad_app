import { loadEnvConfig } from "@next/env";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../lib/generated/prisma/client";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

/**
 * One-time backfill: assigns saleYear/saleNumber (chronological, reset per
 * year) and reconstructs POS sessions (one per calendar day of activity) for
 * sales created before PosSession/sale numbering existed. Safe to re-run: it
 * no-ops as soon as any PosSession or linked sale is found, so it never
 * renumbers or duplicates sessions on a second run.
 */
async function main() {
  const existingSessionCount = await prisma.posSession.count();
  const alreadyLinkedCount = await prisma.sale.count({
    where: { posSessionId: { not: null } },
  });
  if (existingSessionCount > 0 || alreadyLinkedCount > 0) {
    console.log(
      `Already backfilled (sessions=${existingSessionCount}, linked sales=${alreadyLinkedCount}). Nothing to do.`,
    );
    await prisma.$disconnect();
    return;
  }

  const sales = await prisma.sale.findMany({
    where: { saleYear: null },
    select: { id: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  if (sales.length === 0) {
    console.log("No sale needs backfilling.");
    await prisma.$disconnect();
    return;
  }

  console.log(`Backfilling ${sales.length} historical sale(s)...`);

  const saleNumberByYear = new Map<number, number>();
  let sessionNumber = 0;
  let currentSessionId: string | null = null;
  let currentSessionDayStart: Date | null = null;

  await prisma.$transaction(
    async (tx) => {
      for (const sale of sales) {
        const date = sale.createdAt;
        const year = date.getFullYear();
        const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());

        if (
          !currentSessionId ||
          !currentSessionDayStart ||
          dayStart.getTime() !== currentSessionDayStart.getTime()
        ) {
          if (currentSessionId) {
            await tx.posSession.update({
              where: { id: currentSessionId },
              data: { status: "CLOSED", closedAt: date },
            });
          }
          sessionNumber += 1;
          const created = await tx.posSession.create({
            data: {
              number: sessionNumber,
              year,
              openedAt: date,
              status: "CLOSED",
            },
          });
          currentSessionId = created.id;
          currentSessionDayStart = dayStart;
        }

        const nextNumber = (saleNumberByYear.get(year) ?? 0) + 1;
        saleNumberByYear.set(year, nextNumber);

        await tx.sale.update({
          where: { id: sale.id },
          data: {
            saleYear: year,
            saleNumber: nextNumber,
            posSessionId: currentSessionId,
          },
        });
      }

      // If the last reconstructed session is today's, leave it OPEN so the
      // next real sale attaches to it instead of opening a duplicate.
      if (currentSessionId && currentSessionDayStart) {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (currentSessionDayStart.getTime() === todayStart.getTime()) {
          await tx.posSession.update({
            where: { id: currentSessionId },
            data: { status: "OPEN", closedAt: null },
          });
        }
      }
    },
    { timeout: 5 * 60 * 1000 },
  );

  console.log(
    `Done. Created ${sessionNumber} POS session(s) and numbered ${sales.length} sale(s).`,
  );
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
