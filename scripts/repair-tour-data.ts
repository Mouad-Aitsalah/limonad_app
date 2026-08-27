import { loadEnvConfig } from "@next/env";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../lib/generated/prisma/client";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const openTourStatuses = ["DRAFT", "PREPARED", "LOADED", "IN_PROGRESS"] as const;

type Args = Record<string, string | boolean | string[]>;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const action = stringArg(args.action);
  const execute = args.execute === true;

  if (!action) {
    printUsage();
    return;
  }

  if (action === "cancel") {
    await cancelTourAction(requiredArg(args.tour, "--tour"), execute);
    return;
  }

  if (action === "mark-returned") {
    await markReturnedAction(requiredArg(args.tour, "--tour"), execute);
    return;
  }

  if (action === "mark-waiting-for-closure") {
    await markWaitingForClosureAction(requiredArg(args.tour, "--tour"), execute);
    return;
  }

  if (action === "prepare-test-tour") {
    await prepareTestTourAction(args, execute);
    return;
  }

  throw new Error(`Action inconnue: ${action}`);
}

async function cancelTourAction(tourCodeOrId: string, execute: boolean) {
  const tour = await findTour(tourCodeOrId);
  const salesCount = await prisma.sale.count({
    where: {
      organizationId: tour.organizationId,
      tourId: tour.id,
    },
  });
  const hasValidatedLoading = tour.loading?.status === "VALIDATED";

  const plan = {
    action: "cancel",
    execute,
    tour: summarizeTour(tour),
    checks: {
      salesCount,
      hasValidatedLoading,
      allowed: salesCount === 0 && !hasValidatedLoading,
    },
    changes: [
      { model: "Tour", id: tour.id, data: { status: "CANCELLED" } },
      { model: "TruckLoading", where: { tourId: tour.id, status: "DRAFT" }, data: { status: "CANCELLED" } },
      { model: "Truck", id: tour.truckId, data: { status: "AVAILABLE" }, conditional: "si aucune autre tournee ouverte" },
    ],
  };

  if (!plan.checks.allowed) {
    console.log(JSON.stringify({ ...plan, refused: true }, null, 2));
    return;
  }
  if (!execute) {
    console.log(JSON.stringify({ ...plan, dryRun: true }, null, 2));
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.tour.update({ where: { id: tour.id }, data: { status: "CANCELLED" } });
    await tx.truckLoading.updateMany({
      where: {
        organizationId: tour.organizationId,
        tourId: tour.id,
        status: "DRAFT",
      },
      data: { status: "CANCELLED" },
    });
    const otherOpen = await tx.tour.count({
      where: {
        organizationId: tour.organizationId,
        id: { not: tour.id },
        truckId: tour.truckId,
        status: { in: [...openTourStatuses] },
      },
    });
    if (otherOpen === 0) {
      await tx.truck.update({ where: { id: tour.truckId }, data: { status: "AVAILABLE" } });
    }
  });

  console.log(JSON.stringify({ ...plan, applied: true }, null, 2));
}

async function markReturnedAction(tourCodeOrId: string, execute: boolean) {
  const tour = await findTour(tourCodeOrId);
  const allowed = tour.status === "IN_PROGRESS";
  const returnedAt = new Date();
  const plan = {
    action: "mark-returned",
    execute,
    tour: summarizeTour(tour),
    checks: { allowed },
    changes: [
      { model: "Tour", id: tour.id, data: { status: "WAITING_FOR_CLOSURE", returnedAt: returnedAt.toISOString() } },
      { model: "Truck", id: tour.truckId, data: { status: "AVAILABLE" } },
    ],
  };

  if (!allowed) {
    console.log(JSON.stringify({ ...plan, refused: true }, null, 2));
    return;
  }
  if (!execute) {
    console.log(JSON.stringify({ ...plan, dryRun: true }, null, 2));
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.tour.update({
      where: { id: tour.id },
      data: { status: "WAITING_FOR_CLOSURE", returnedAt },
    });
    await tx.truck.update({ where: { id: tour.truckId }, data: { status: "AVAILABLE" } });
  });

  console.log(JSON.stringify({ ...plan, applied: true }, null, 2));
}

async function markWaitingForClosureAction(tourCodeOrId: string, execute: boolean) {
  const tour = await findTour(tourCodeOrId);
  const salesCount = await prisma.sale.count({
    where: {
      organizationId: tour.organizationId,
      tourId: tour.id,
    },
  });
  const hasValidatedLoading = tour.loading?.status === "VALIDATED";
  const returnedAt = tour.returnedAt ?? new Date();
  const allowed =
    tour.status === "IN_PROGRESS" &&
    salesCount > 0 &&
    !hasValidatedLoading;

  const plan = {
    action: "mark-waiting-for-closure",
    execute,
    tour: summarizeTour(tour),
    checks: {
      currentStatus: tour.status,
      salesCount,
      hasValidatedLoading,
      alreadyClosedOrCancelled: ["WAITING_FOR_CLOSURE", "CLOSED", "CANCELLED"].includes(tour.status),
      allowed,
    },
    changes: [
      {
        model: "Tour",
        id: tour.id,
        data: {
          status: "WAITING_FOR_CLOSURE",
          returnedAt: returnedAt.toISOString(),
        },
      },
      {
        model: "Truck",
        id: tour.truckId,
        data: { status: "AVAILABLE" },
        conditional: "si aucune autre tournee ouverte pour ce camion",
      },
    ],
    untouched: [
      "Aucun chargement valide n'est cree retroactivement.",
      "Aucune vente n'est supprimee ou modifiee.",
      "Aucun paiement n'est supprime ou modifie.",
      "Aucun mouvement de stock n'est supprime ou modifie.",
    ],
  };

  if (!allowed) {
    console.log(JSON.stringify({ ...plan, refused: true }, null, 2));
    return;
  }
  if (!execute) {
    console.log(JSON.stringify({ ...plan, dryRun: true }, null, 2));
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.tour.update({
      where: { id: tour.id },
      data: { status: "WAITING_FOR_CLOSURE", returnedAt },
    });
    const otherOpen = await tx.tour.count({
      where: {
        organizationId: tour.organizationId,
        id: { not: tour.id },
        truckId: tour.truckId,
        status: { in: [...openTourStatuses] },
      },
    });
    if (otherOpen === 0) {
      await tx.truck.update({
        where: { id: tour.truckId },
        data: { status: "AVAILABLE" },
      });
    }
  });

  console.log(JSON.stringify({ ...plan, applied: true }, null, 2));
}

async function prepareTestTourAction(args: Args, execute: boolean) {
  const driverEmail = requiredArg(args["driver-email"], "--driver-email");
  const date = normalizeDate(stringArg(args.date) ?? new Date().toISOString());
  const createdByUser = await resolveCreatedByUser(args, execute);

  const driver = await prisma.driver.findFirst({
    where: { user: { email: driverEmail } },
    include: {
      user: { select: { email: true, fullName: true } },
      truck: {
        include: {
          depot: { select: { id: true, code: true, name: true } },
          stockLocation: { select: { id: true, code: true } },
        },
      },
    },
  });
  if (!driver?.truck) throw new Error("Chauffeur ou camion introuvable.");
  if (!driver.truck.stockLocation) throw new Error("StockLocation camion introuvable.");

  const [openDriverTours, openTruckTours, depotLocation] = await Promise.all([
    prisma.tour.findMany({
      where: {
        organizationId: driver.organizationId,
        driverId: driver.id,
        status: { in: [...openTourStatuses] },
      },
      select: { id: true, code: true, status: true },
    }),
    prisma.tour.findMany({
      where: {
        organizationId: driver.organizationId,
        truckId: driver.truck.id,
        status: { in: [...openTourStatuses] },
      },
      select: { id: true, code: true, status: true },
    }),
    prisma.stockLocation.findFirst({
      where: {
        organizationId: driver.organizationId,
        depotId: driver.truck.depotId,
      },
      select: { id: true, code: true },
    }),
  ]);
  if (!depotLocation) throw new Error("StockLocation depot introuvable.");

  const blockers = {
    openDriverTours,
    openTruckTours,
  };
  if (openDriverTours.length > 0 || openTruckTours.length > 0) {
    console.log(
      JSON.stringify(
        {
          action: "prepare-test-tour",
          execute,
          refused: true,
          reason: "Le chauffeur ou le camion possede deja une tournee ouverte.",
          driver: { id: driver.id, name: driver.user.fullName, email: driver.user.email },
          truck: { id: driver.truck.id, code: driver.truck.code },
          blockers,
          nextStep: "Reparer explicitement les anciennes tournees avant de creer la tournee de test.",
        },
        null,
        2,
      ),
    );
    return;
  }

  const lines = await resolveLoadingLines(args, driver.organizationId, depotLocation.id);
  const now = new Date();
  const tourCode = `TEST-${driver.truck.code}-${Date.now()}`;
  const plan = {
    action: "prepare-test-tour",
    execute,
    tour: {
      code: tourCode,
      date: date.toISOString(),
      driver: { id: driver.id, name: driver.user.fullName, email: driver.user.email },
      truck: { id: driver.truck.id, code: driver.truck.code },
      depot: driver.truck.depot,
    },
    createdByUser,
    loadingLines: lines,
    changes: [
      "Creation Tour IN_PROGRESS",
      "Creation TruckLoading VALIDATED",
      "Transfert stock depot vers camion",
      "Creation StockMovement TRUCK_LOADING par ligne",
      "Passage camion ON_TOUR",
    ],
  };

  if (!execute) {
    console.log(JSON.stringify({ ...plan, dryRun: true }, null, 2));
    return;
  }

  const createdByUserId = createdByUser.id;
  if (!createdByUserId) {
    throw new Error("--created-by-email est obligatoire avec --execute.");
  }

  await prisma.$transaction(
    async (tx) => {
      const tour = await tx.tour.create({
        data: {
          organizationId: driver.organizationId,
          code: tourCode,
          date,
          depotId: driver.truck!.depotId,
          truckId: driver.truck!.id,
          driverId: driver.id,
          status: "IN_PROGRESS",
          startedAt: now,
          createdByUserId,
        },
      });
      const loading = await tx.truckLoading.create({
        data: {
          organizationId: driver.organizationId,
          loadingNumber: `TEST-CHG-${Date.now()}`,
          tourId: tour.id,
          depotId: driver.truck!.depotId,
          truckId: driver.truck!.id,
          driverId: driver.id,
          date,
          status: "VALIDATED",
          validatedAt: now,
          validatedByUserId: createdByUserId,
          createdByUserId,
          lines: {
            createMany: {
              data: lines.map((line) => ({
                productId: line.productId,
                quantity: line.quantity,
              })),
            },
          },
        },
      });

      for (const line of lines) {
        await tx.stockLevel.update({
          where: {
            productId_locationId: {
              productId: line.productId,
              locationId: depotLocation.id,
            },
          },
          data: { quantity: { decrement: line.quantity } },
        });
        await tx.stockLevel.upsert({
          where: {
            productId_locationId: {
              productId: line.productId,
              locationId: driver.truck!.stockLocation!.id,
            },
          },
          update: { quantity: { increment: line.quantity } },
          create: {
            organizationId: driver.organizationId,
            productId: line.productId,
            locationId: driver.truck!.stockLocation!.id,
            quantity: line.quantity,
            reservedQuantity: 0,
          },
        });
        await tx.stockMovement.create({
          data: {
            organizationId: driver.organizationId,
            movementNumber: await nextMovementNumber(tx, driver.organizationId),
            type: "TRUCK_LOADING",
            productId: line.productId,
            quantity: line.quantity,
            sourceLocationId: depotLocation.id,
            destinationLocationId: driver.truck!.stockLocation!.id,
            referenceType: "TRUCK_LOADING",
            referenceId: loading.id,
            reason: "Preparation tournee de test",
            createdByUserId,
            status: "VALIDATED",
          },
        });
      }

      await tx.truck.update({
        where: { id: driver.truck!.id },
        data: { status: "ON_TOUR" },
      });
    },
    { isolationLevel: "Serializable" },
  );

  console.log(JSON.stringify({ ...plan, applied: true }, null, 2));
}

async function resolveCreatedByUser(args: Args, execute: boolean) {
  const email = stringArg(args["created-by-email"]);
  if (!email) {
    if (execute) {
      throw new Error("--created-by-email est obligatoire avec --execute.");
    }
    return { id: null, email: null, name: "A renseigner avec --created-by-email" };
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, fullName: true, status: true },
  });
  if (!user || user.status !== "ACTIVE") {
    throw new Error(`Utilisateur createur introuvable ou inactif: ${email}`);
  }

  return { id: user.id, email: user.email, name: user.fullName };
}

async function resolveLoadingLines(
  args: Args,
  organizationId: string,
  depotLocationId: string,
) {
  const explicitLines = arrayArg(args.line);

  if (explicitLines.length > 0) {
    return Promise.all(
      explicitLines.map(async (line) => {
        const [reference, quantityText] = line.split(":");
        const quantity = Number(quantityText);
        if (!reference || !Number.isInteger(quantity) || quantity <= 0) {
          throw new Error(`Ligne invalide: ${line}`);
        }
        const product = await prisma.product.findUnique({
          where: {
            organizationId_reference: {
              organizationId,
              reference,
            },
          },
          select: { id: true, reference: true, name: true },
        });
        if (!product) throw new Error(`Produit introuvable: ${reference}`);
        await ensureDepotStock(product.id, depotLocationId, quantity);
        return { productId: product.id, reference: product.reference, name: product.name, quantity };
      }),
    );
  }

  const available = await prisma.stockLevel.findMany({
    where: {
      organizationId,
      locationId: depotLocationId,
      quantity: { gt: 0 },
      product: { status: "ACTIVE" },
    },
    include: { product: { select: { reference: true, name: true } } },
    orderBy: { product: { name: "asc" } },
    take: 3,
  });

  if (available.length === 0) throw new Error("Aucun stock depot disponible.");
  return available.map((level) => ({
    productId: level.productId,
    reference: level.product.reference,
    name: level.product.name,
    quantity: Math.min(2, level.quantity),
  }));
}

async function ensureDepotStock(productId: string, depotLocationId: string, quantity: number) {
  const level = await prisma.stockLevel.findUnique({
    where: { productId_locationId: { productId, locationId: depotLocationId } },
    select: { quantity: true, reservedQuantity: true },
  });
  const available = (level?.quantity ?? 0) - (level?.reservedQuantity ?? 0);
  if (available < quantity) {
    throw new Error(`Stock depot insuffisant pour ${productId}: ${available}/${quantity}`);
  }
}

async function findTour(codeOrId: string) {
  const tour = await prisma.tour.findFirst({
    where: { OR: [{ id: codeOrId }, { code: codeOrId }] },
    include: {
      loading: { select: { id: true, loadingNumber: true, status: true } },
      driver: { select: { id: true, user: { select: { fullName: true } } } },
      truck: { select: { id: true, code: true } },
    },
  });
  if (!tour) throw new Error(`Tournee introuvable: ${codeOrId}`);
  return tour;
}

function summarizeTour(tour: Awaited<ReturnType<typeof findTour>>) {
  return {
    id: tour.id,
    code: tour.code,
    status: tour.status,
    driver: { id: tour.driver.id, name: tour.driver.user.fullName },
    truck: { id: tour.truck.id, code: tour.truck.code },
    loading: tour.loading,
  };
}

async function nextMovementNumber(
  tx: Pick<typeof prisma, "stockMovement">,
  organizationId: string,
) {
  const count = await tx.stockMovement.count({ where: { organizationId } });
  return `MV-${String(count + 1).padStart(6, "0")}`;
}

function normalizeDate(value: string) {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function parseArgs(args: string[]): Args {
  const parsed: Args = {};
  for (const arg of args) {
    if (!arg.startsWith("--")) continue;
    const [key, value] = arg.slice(2).split("=");
    if (!value) {
      parsed[key] = true;
      continue;
    }
    if (key === "line") {
      parsed.line = [...arrayArg(parsed.line), value];
      continue;
    }
    parsed[key] = value;
  }
  return parsed;
}

function stringArg(value: string | boolean | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

function arrayArg(value: string | boolean | string[] | undefined) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return [value];
  return [];
}

function requiredArg(value: string | boolean | string[] | undefined, name: string) {
  const result = stringArg(value);
  if (!result) throw new Error(`${name} est obligatoire.`);
  return result;
}

function printUsage() {
  console.log(`Usage:
  npx tsx scripts/repair-tour-data.ts --tour=TOUR-2026-001 --action=cancel
  npx tsx scripts/repair-tour-data.ts --tour=TOUR-2026-001 --action=cancel --execute
  npx tsx scripts/repair-tour-data.ts --tour=TOUR-2026-001 --action=mark-returned --execute
  npx tsx scripts/repair-tour-data.ts --tour=TOUR-2026-001 --action=mark-waiting-for-closure
  npx tsx scripts/repair-tour-data.ts --tour=TOUR-2026-001 --action=mark-waiting-for-closure --execute
  npx tsx scripts/repair-tour-data.ts --action=prepare-test-tour --driver-email=chauffeur@comdis.local
  npx tsx scripts/repair-tour-data.ts --action=prepare-test-tour --driver-email=chauffeur@comdis.local --created-by-email=admin@comdis.local --execute
`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
