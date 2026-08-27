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
  const sales = await prisma.sale.findMany({
    where: { saleYear: null },
    select: { id: true, organizationId: true, createdAt: true },
    orderBy: [{ organizationId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });

  if (sales.length === 0) {
    console.log("No sale needs backfilling.");
    await prisma.$disconnect();
    return;
  }

  console.log(`Backfilling ${sales.length} historical sale(s)...`);

  const existingSales = await prisma.sale.findMany({
    where: { saleYear: { not: null }, saleNumber: { not: null } },
    select: { organizationId: true, saleYear: true, saleNumber: true },
  });
  const saleNumberByOrganizationYear = new Map<string, number>();
  for (const sale of existingSales) {
    if (sale.saleYear === null || sale.saleNumber === null) continue;
    const key = `${sale.organizationId}:${sale.saleYear}`;
    const currentMax = saleNumberByOrganizationYear.get(key) ?? 0;
    saleNumberByOrganizationYear.set(key, Math.max(currentMax, sale.saleNumber));
  }

  const existingSessions = await prisma.posSession.findMany({
    select: { organizationId: true, year: true, number: true },
  });
  const sessionNumberByOrganizationYear = new Map<string, number>();
  for (const session of existingSessions) {
    const key = `${session.organizationId}:${session.year}`;
    const currentMax = sessionNumberByOrganizationYear.get(key) ?? 0;
    sessionNumberByOrganizationYear.set(key, Math.max(currentMax, session.number));
  }

  const currentSessionByOrganization = new Map<
    string,
    { id: string; dayStart: Date }
  >();
  let createdSessionCount = 0;

  await prisma.$transaction(
    async (tx) => {
      for (const sale of sales) {
        const date = sale.createdAt;
        const year = date.getFullYear();
        const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const sessionKey = `${sale.organizationId}:${year}`;
        const currentSession = currentSessionByOrganization.get(sale.organizationId) ?? null;

        if (
          !currentSession ||
          dayStart.getTime() !== currentSession.dayStart.getTime()
        ) {
          if (currentSession) {
            await tx.posSession.update({
              where: { id: currentSession.id },
              data: { status: "CLOSED", closedAt: date },
            });
          }

          const nextSessionNumber =
            (sessionNumberByOrganizationYear.get(sessionKey) ?? 0) + 1;
          sessionNumberByOrganizationYear.set(sessionKey, nextSessionNumber);

          const created = await tx.posSession.create({
            data: {
              organizationId: sale.organizationId,
              number: nextSessionNumber,
              year,
              openedAt: date,
              status: "CLOSED",
            },
          });
          currentSessionByOrganization.set(sale.organizationId, {
            id: created.id,
            dayStart,
          });
          createdSessionCount += 1;
        }

        const currentSessionId =
          currentSessionByOrganization.get(sale.organizationId)?.id ?? null;
        if (!currentSessionId) {
          throw new Error(`Missing reconstructed POS session for sale ${sale.id}.`);
        }

        const saleKey = `${sale.organizationId}:${year}`;
        const nextNumber = (saleNumberByOrganizationYear.get(saleKey) ?? 0) + 1;
        saleNumberByOrganizationYear.set(saleKey, nextNumber);

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
      for (const session of currentSessionByOrganization.values()) {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (session.dayStart.getTime() === todayStart.getTime()) {
          await tx.posSession.update({
            where: { id: session.id },
            data: { status: "OPEN", closedAt: null },
          });
        }
      }
    },
    { timeout: 5 * 60 * 1000 },
  );

  console.log(
    `Done. Created ${createdSessionCount} POS session(s) and numbered ${sales.length} sale(s).`,
  );
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
