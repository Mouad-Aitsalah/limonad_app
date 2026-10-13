import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/lib/generated/prisma/client";
import { remainingGap, theoreticalRemaining } from "@/lib/truck-loading-remaining";

import {
  applyLoadingStockDelta,
  INITIAL_LOAD_REPRISE_REASON,
  INITIAL_LOAD_REPRISE_REVERSAL_REASON,
  openingQuantitiesByProduct,
  recordRemainingCounts,
  shiftedTheoreticalSnapshots,
  type LoadingSequences,
} from "./truck-loading-stock-core";

/**
 * Stock of the "transferts de stock" against a REAL database (run it on the
 * isolated test database only): every test runs inside ONE transaction that is
 * always rolled back - nothing is kept. The fiche steps below replay what
 * lib/server/truck-loadings.ts does inside its own transactions (read the
 * persisted lines, apply the stock delta, rewrite the lines, record the
 * counts), with the same core functions; the wiring of the real services is
 * checked at the end (source level). Skipped when no database is reachable.
 */

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
let reachable = false;

before(async () => {
  try {
    await Promise.race([prisma.$queryRaw`select 1`, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 20_000))]);
    reachable = true;
  } catch {
    reachable = false;
  }
});

after(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

class Rollback extends Error {}
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
const uid = () => randomUUID().replace(/-/g, "").slice(0, 10);

async function inRollback(run: (tx: Tx) => Promise<void>) {
  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        await run(tx);
        throw new Rollback();
      },
      { timeout: 120_000, maxWait: 20_000 },
    ),
    Rollback,
  );
}

let sequence = 0;
/** Sortable numbers: rows created in one transaction share the same createdAt, so tests order by number. */
const nextNumber = () => `MV-T-${String(++sequence).padStart(9, "0")}`;
const SEQUENCES: LoadingSequences = { nextMovementNumber: async () => nextNumber() };

async function makeWorld(tx: Tx) {
  const suffix = uid();
  const organization = await tx.organization.create({ data: { code: `T-TLS-${suffix}`.toUpperCase(), name: "Test transferts" } });
  const user = await tx.user.create({
    data: { organizationId: organization.id, firstName: "A", lastName: "B", fullName: "Admin test", email: `tls-${suffix}@example.invalid`, passwordHash: "x", role: "ADMIN" },
  });
  const depot = await tx.depot.create({ data: { organizationId: organization.id, code: `D-${suffix}`, name: "Depot", address: "-", city: "-" } });
  const depotLocation = await tx.stockLocation.create({ data: { organizationId: organization.id, code: `LD-${suffix}`, name: "Depot", type: "DEPOT", depotId: depot.id } });
  const category = await tx.category.create({ data: { organizationId: organization.id, code: `C-${suffix}`, name: "Boissons", active: true } });
  const product = (name: string) =>
    tx.product.create({
      data: { organizationId: organization.id, reference: `${name}-${suffix}`, name, categoryId: category.id, purchasePrice: 1, salePrice: 2, taxRate: 20, unit: "u" },
    });
  const p1 = await product("P1");
  const p2 = await product("P2");
  const makeTruck = async (code: string) => {
    const truck = await tx.truck.create({ data: { organizationId: organization.id, code: `${code}-${suffix}`, registration: code, depotId: depot.id } });
    const location = await tx.stockLocation.create({ data: { organizationId: organization.id, code: `LT-${code}-${suffix}`, name: code, type: "TRUCK", truckId: truck.id } });
    const driverUser = await tx.user.create({
      data: { organizationId: organization.id, firstName: "C", lastName: code, fullName: `Chauffeur ${code}`, email: `tls-${code}-${suffix}@example.invalid`, passwordHash: "x", role: "DRIVER" },
    });
    const driver = await tx.driver.create({ data: { organizationId: organization.id, employeeCode: `E-${code}-${suffix}`, userId: driverUser.id } });
    return { truck, locationId: location.id, driver };
  };
  const truckA = await makeTruck("A");
  const truckB = await makeTruck("B");
  return { organizationId: organization.id, userId: user.id, depotId: depot.id, depotLocationId: depotLocation.id, p1: p1.id, p2: p2.id, truckA, truckB };
}
type World = Awaited<ReturnType<typeof makeWorld>>;
type TruckRef = World["truckA"];

async function setStock(tx: Tx, world: World, locationId: string, productId: string, quantity: number) {
  await tx.stockLevel.upsert({
    where: { productId_locationId: { productId, locationId } },
    update: { quantity },
    create: { organizationId: world.organizationId, productId, locationId, quantity, reservedQuantity: 0 },
  });
}
async function stockOf(tx: Tx, locationId: string, productId: string) {
  return (await tx.stockLevel.findUnique({ where: { productId_locationId: { productId, locationId } } }))?.quantity ?? 0;
}
async function movementsOf(tx: Tx, loadingId: string) {
  return tx.stockMovement.findMany({
    where: { referenceId: loadingId },
    orderBy: { movementNumber: "asc" },
    select: { type: true, productId: true, quantity: true, sourceLocationId: true, destinationLocationId: true, reason: true },
  });
}
/** A driver sale: the truck stock goes down, one TRUCK_SALE movement (what driver-sales.ts records). */
async function sell(tx: Tx, world: World, truck: TruckRef, productId: string, quantity: number) {
  await tx.stockLevel.update({ where: { productId_locationId: { productId, locationId: truck.locationId } }, data: { quantity: { decrement: quantity } } });
  return tx.stockMovement.create({
    data: {
      organizationId: world.organizationId,
      movementNumber: nextNumber(),
      type: "TRUCK_SALE",
      productId,
      quantity,
      sourceLocationId: truck.locationId,
      referenceType: "SALE",
      createdByUserId: world.userId,
      status: "VALIDATED",
    },
    select: { id: true },
  });
}

type Line = { productId: string; initial: number; reload: number; actual?: number | null };

async function openFiche(tx: Tx, world: World, truck: TruckRef) {
  return tx.truckLoading.create({
    data: {
      organizationId: world.organizationId,
      loadingNumber: `CHG-T-${uid()}`,
      driverId: truck.driver.id,
      date: new Date("2026-10-12"),
      depotId: world.depotId,
      truckId: truck.truck.id,
      createdByUserId: world.userId,
    },
  });
}

/** = updateOpenLoadingLines (autosave of an OPEN fiche) / updateLoadingLines (correction). */
async function saveLines(tx: Tx, world: World, truck: TruckRef, loadingId: string, lines: Line[]) {
  const current = await tx.truckLoading.findUniqueOrThrow({
    where: { id: loadingId },
    select: {
      status: true,
      stockAppliedAt: true,
      loadingNumber: true,
      lines: { select: { productId: true, quantity: true, reloadedQuantity: true, theoreticalRemainingQuantity: true } },
    },
  });
  if (current.status === "CANCELLED") throw new Error("409 annule");
  const nextLines = lines.map((line) => ({
    productId: line.productId,
    initialQuantity: line.initial,
    reloadedQuantity: line.reload,
    quantity: line.initial + line.reload,
  }));
  await applyLoadingStockDelta(tx, {
    loadingId,
    loadingNumber: current.loadingNumber,
    depotLocationId: world.depotLocationId,
    truckLocationId: truck.locationId,
    previousLines: current.lines,
    nextLines,
    stockAlreadyApplied: Boolean(current.stockAppliedAt),
    replaceInitial: current.status === "DRAFT",
    organizationId: world.organizationId,
    userId: world.userId,
    sequences: SEQUENCES,
  });
  let theoretical = new Map<string, number>();
  if (current.status === "VALIDATED") {
    const live = new Map<string, number>();
    for (const line of nextLines) live.set(line.productId, await stockOf(tx, truck.locationId, line.productId));
    theoretical = shiftedTheoreticalSnapshots(current.lines, nextLines, (productId) => live.get(productId) ?? 0);
  }
  await tx.truckLoadingLine.deleteMany({ where: { loadingId } });
  await tx.truckLoadingLine.createMany({
    data: lines.map((line) => ({
      loadingId,
      productId: line.productId,
      quantity: line.initial + line.reload,
      reloadedQuantity: line.reload,
      actualRemainingQuantity: line.actual ?? null,
      theoreticalRemainingQuantity: theoretical.get(line.productId) ?? null,
    })),
  });
  await tx.truckLoading.update({ where: { id: loadingId }, data: { stockAppliedAt: current.stockAppliedAt ?? new Date() } });
}

/** = closeLoading: counts optional, recorded with the theoretical of the moment, never a stock write. */
async function closeFiche(tx: Tx, truck: TruckRef, loadingId: string, counts: Record<string, number | null>) {
  const current = await tx.truckLoading.findUniqueOrThrow({
    where: { id: loadingId },
    select: { status: true, lines: { select: { productId: true, actualRemainingQuantity: true } } },
  });
  if (current.status === "VALIDATED") throw new Error("409 deja ferme");
  await recordRemainingCounts(tx, {
    loadingId,
    truckLocationId: truck.locationId,
    lines: current.lines.map((line) => ({
      productId: line.productId,
      actualRemainingQuantity: line.productId in counts ? counts[line.productId] : line.actualRemainingQuantity,
    })),
  });
  await tx.truckLoading.update({ where: { id: loadingId }, data: { status: "VALIDATED", validatedAt: new Date() } });
}

/** = cancelDraftLoading: everything the fiche applied is reversed. */
async function cancelFiche(tx: Tx, world: World, truck: TruckRef, loadingId: string) {
  const current = await tx.truckLoading.findUniqueOrThrow({
    where: { id: loadingId },
    select: { status: true, loadingNumber: true, stockAppliedAt: true, lines: { select: { productId: true, quantity: true, reloadedQuantity: true } } },
  });
  if (current.status !== "DRAFT") throw new Error("409");
  if (current.stockAppliedAt) {
    await applyLoadingStockDelta(tx, {
      loadingId,
      loadingNumber: current.loadingNumber,
      depotLocationId: world.depotLocationId,
      truckLocationId: truck.locationId,
      previousLines: current.lines,
      nextLines: [],
      stockAlreadyApplied: true,
      replaceInitial: true,
      organizationId: world.organizationId,
      userId: world.userId,
      sequences: SEQUENCES,
    });
  }
  await tx.truckLoading.update({ where: { id: loadingId }, data: { status: "CANCELLED" } });
}

async function lineOf(tx: Tx, loadingId: string, productId: string) {
  return tx.truckLoadingLine.findUniqueOrThrow({ where: { loadingId_productId: { loadingId, productId } } });
}
async function gapOf(tx: Tx, loadingId: string, productId: string, status = "VALIDATED") {
  const line = await lineOf(tx, loadingId, productId);
  return remainingGap(
    line.actualRemainingQuantity,
    theoreticalRemaining({ theoreticalRemainingQuantity: line.theoreticalRemainingQuantity, truckCurrentQuantity: null, actualRemainingQuantity: line.actualRemainingQuantity }, status),
  );
}

const skipUnlessDb = (t: { skip: (message: string) => void }) => {
  if (!reachable) {
    t.skip("no database reachable");
    return true;
  }
  return false;
};

// 1 ------------------------------------------------------------------------------------------
test("charge initiale REPLACES the truck stock: 50 -> initial 100 = 100 (not 150); old stock taken back to the depot (depot net -50), 2 traced movements", async (t) => {
  if (skipUnlessDb(t)) return;
  await inRollback(async (tx) => {
    const world = await makeWorld(tx);
    await setStock(tx, world, world.truckA.locationId, world.p1, 50);
    await setStock(tx, world, world.depotLocationId, world.p1, 500);
    const fiche = await openFiche(tx, world, world.truckA);
    await saveLines(tx, world, world.truckA, fiche.id, [{ productId: world.p1, initial: 100, reload: 0 }]);
    assert.equal(await stockOf(tx, world.truckA.locationId, world.p1), 100);
    assert.equal(await stockOf(tx, world.depotLocationId, world.p1), 450, "500 + 50 taken back - 100 loaded");
    const movements = await movementsOf(tx, fiche.id);
    assert.deepEqual(
      movements.map((m) => [m.reason, m.quantity, m.sourceLocationId, m.destinationLocationId]),
      [
        [INITIAL_LOAD_REPRISE_REASON, 50, world.truckA.locationId, world.depotLocationId],
        ["Chargement brouillon applique", 100, world.depotLocationId, world.truckA.locationId],
      ],
    );
  });
});

// 2 ------------------------------------------------------------------------------------------
test("recharge ADDS to the truck stock: 100 + 30 = 130, never a replacement (no new reprise)", async (t) => {
  if (skipUnlessDb(t)) return;
  await inRollback(async (tx) => {
    const world = await makeWorld(tx);
    await setStock(tx, world, world.truckA.locationId, world.p1, 50);
    const fiche = await openFiche(tx, world, world.truckA);
    await saveLines(tx, world, world.truckA, fiche.id, [{ productId: world.p1, initial: 100, reload: 0 }]);
    await saveLines(tx, world, world.truckA, fiche.id, [{ productId: world.p1, initial: 100, reload: 30 }]);
    assert.equal(await stockOf(tx, world.truckA.locationId, world.p1), 130);
    const reprises = (await movementsOf(tx, fiche.id)).filter((m) => m.reason === INITIAL_LOAD_REPRISE_REASON);
    assert.equal(reprises.length, 1);
    // a recharge typed BEFORE the initial load is kept: only the old stock is taken back
    const world2 = await makeWorld(tx);
    await setStock(tx, world2, world2.truckA.locationId, world2.p1, 50);
    const fiche2 = await openFiche(tx, world2, world2.truckA);
    await saveLines(tx, world2, world2.truckA, fiche2.id, [{ productId: world2.p1, initial: 0, reload: 30 }]);
    assert.equal(await stockOf(tx, world2.truckA.locationId, world2.p1), 80, "recharge alone adds");
    await saveLines(tx, world2, world2.truckA, fiche2.id, [{ productId: world2.p1, initial: 100, reload: 30 }]);
    assert.equal(await stockOf(tx, world2.truckA.locationId, world2.p1), 130, "initial 100 replaces the old 50, the recharge 30 stays");
  });
});

// 3 4 5 6 ------------------------------------------------------------------------------------
test("restant reel is a COUNT only: 75 vs 80 -> -5, 80 -> 0, 85 -> +5, absent -> no gap; no stock, no movement", async (t) => {
  if (skipUnlessDb(t)) return;
  await inRollback(async (tx) => {
    const world = await makeWorld(tx);
    for (const [actual, expectedGap] of [
      [75, -5],
      [80, 0],
      [85, 5],
      [null, null],
    ] as const) {
      // fresh truck per case: initial 100 on an empty truck, 20 sold -> theoretical 80
      const truck = actual === 75 ? world.truckA : world.truckB;
      await setStock(tx, world, truck.locationId, world.p1, 0);
      const fiche = await openFiche(tx, world, truck);
      await saveLines(tx, world, truck, fiche.id, [{ productId: world.p1, initial: 100, reload: 0 }]);
      await sell(tx, world, truck, world.p1, 20);
      const truckBefore = await stockOf(tx, truck.locationId, world.p1);
      const depotBefore = await stockOf(tx, world.depotLocationId, world.p1);
      const movementsBefore = await tx.stockMovement.count({ where: { organizationId: world.organizationId } });
      await closeFiche(tx, truck, fiche.id, { [world.p1]: actual });
      const line = await lineOf(tx, fiche.id, world.p1);
      assert.equal(line.theoreticalRemainingQuantity, 80);
      assert.equal(line.actualRemainingQuantity, actual, "null stays null, never 0");
      assert.equal(await gapOf(tx, fiche.id, world.p1), expectedGap, `actual ${actual}`);
      assert.equal(await stockOf(tx, truck.locationId, world.p1), truckBefore, "truck stock untouched");
      assert.equal(await stockOf(tx, world.depotLocationId, world.p1), depotBefore, "depot stock untouched");
      assert.equal(await tx.stockMovement.count({ where: { organizationId: world.organizationId } }), movementsBefore, "no movement");
      assert.equal(await tx.stockMovement.count({ where: { organizationId: world.organizationId, type: "INVENTORY_ADJUSTMENT" } }), 0);
      // close the B fiche before the next case reuses truck B
      if (truck === world.truckB) await tx.truckLoading.update({ where: { id: fiche.id }, data: { status: "VALIDATED" } });
    }
  });
});

// 7 8 ----------------------------------------------------------------------------------------
test("draft edited several times then closed: one reprise, only the differences moved; the same save sent twice moves nothing", async (t) => {
  if (skipUnlessDb(t)) return;
  await inRollback(async (tx) => {
    const world = await makeWorld(tx);
    await setStock(tx, world, world.truckA.locationId, world.p1, 50);
    await setStock(tx, world, world.depotLocationId, world.p1, 500);
    const fiche = await openFiche(tx, world, world.truckA);
    await saveLines(tx, world, world.truckA, fiche.id, [{ productId: world.p1, initial: 100, reload: 0 }]);
    await saveLines(tx, world, world.truckA, fiche.id, [{ productId: world.p1, initial: 120, reload: 0 }]);
    await saveLines(tx, world, world.truckA, fiche.id, [{ productId: world.p1, initial: 120, reload: 10, actual: null }]);
    const movementsBeforeRepeat = (await movementsOf(tx, fiche.id)).length;
    // double submission / autosave replay of exactly the same lines
    await saveLines(tx, world, world.truckA, fiche.id, [{ productId: world.p1, initial: 120, reload: 10, actual: 125 }]);
    await saveLines(tx, world, world.truckA, fiche.id, [{ productId: world.p1, initial: 120, reload: 10, actual: 125 }]);
    assert.equal((await movementsOf(tx, fiche.id)).length, movementsBeforeRepeat, "a repeated save moves nothing");
    await closeFiche(tx, world.truckA, fiche.id, {});
    await assert.rejects(closeFiche(tx, world.truckA, fiche.id, {}), /deja ferme/, "a second close is refused");
    const movements = await movementsOf(tx, fiche.id);
    assert.deepEqual(
      movements.map((m) => [m.reason, m.quantity]),
      [
        [INITIAL_LOAD_REPRISE_REASON, 50],
        ["Chargement brouillon applique", 100],
        ["Chargement brouillon applique", 20],
        ["Chargement brouillon applique", 10],
      ],
    );
    assert.equal(await stockOf(tx, world.truckA.locationId, world.p1), 130);
    assert.equal(await stockOf(tx, world.depotLocationId, world.p1), 500 + 50 - 130);
    const line = await lineOf(tx, fiche.id, world.p1);
    assert.deepEqual([line.theoreticalRemainingQuantity, line.actualRemainingQuantity], [130, 125], "the count saved on the draft is kept at the close");
  });
});

// 9 ------------------------------------------------------------------------------------------
test("cancellation / removing the initial load gives the old stock back exactly; a closed fiche is corrected by differences only (never a new reprise)", async (t) => {
  if (skipUnlessDb(t)) return;
  await inRollback(async (tx) => {
    const world = await makeWorld(tx);
    // cancel: truck back to its old 50, depot back to 500, after sales the restored figure follows
    await setStock(tx, world, world.truckA.locationId, world.p1, 50);
    await setStock(tx, world, world.depotLocationId, world.p1, 500);
    const cancelled = await openFiche(tx, world, world.truckA);
    await saveLines(tx, world, world.truckA, cancelled.id, [{ productId: world.p1, initial: 100, reload: 0 }]);
    await cancelFiche(tx, world, world.truckA, cancelled.id);
    assert.equal(await stockOf(tx, world.truckA.locationId, world.p1), 50);
    assert.equal(await stockOf(tx, world.depotLocationId, world.p1), 500);
    assert.deepEqual(
      (await movementsOf(tx, cancelled.id)).map((m) => [m.reason, m.quantity]),
      [
        [INITIAL_LOAD_REPRISE_REASON, 50],
        ["Chargement brouillon applique", 100],
        [INITIAL_LOAD_REPRISE_REVERSAL_REASON, 50],
        ["Correction de chargement brouillon", 100],
      ],
    );
    // initial zeroed on a draft after 10 sold: old stock given back first, then the load leaves
    const draft = await openFiche(tx, world, world.truckA);
    await saveLines(tx, world, world.truckA, draft.id, [{ productId: world.p1, initial: 100, reload: 0 }]);
    await sell(tx, world, world.truckA, world.p1, 10);
    await saveLines(tx, world, world.truckA, draft.id, [{ productId: world.p1, initial: 0, reload: 0 }]);
    assert.equal(await stockOf(tx, world.truckA.locationId, world.p1), 40, "old 50 - 10 sold");
    // re-entered: a NEW reprise of what the truck holds now
    await saveLines(tx, world, world.truckA, draft.id, [{ productId: world.p1, initial: 60, reload: 0 }]);
    assert.equal(await stockOf(tx, world.truckA.locationId, world.p1), 60);

    // correction of a CLOSED fiche: plain differences, theoretical shifted, no reprise
    await closeFiche(tx, world.truckA, draft.id, { [world.p1]: 58 });
    assert.equal((await lineOf(tx, draft.id, world.p1)).theoreticalRemainingQuantity, 60);
    await setStock(tx, world, world.truckA.locationId, world.p1, 7); // the truck lived its life since
    const repriseBefore = (await movementsOf(tx, draft.id)).filter((m) => m.reason === INITIAL_LOAD_REPRISE_REASON).length;
    await saveLines(tx, world, world.truckA, draft.id, [{ productId: world.p1, initial: 70, reload: 0, actual: 58 }]);
    assert.equal(await stockOf(tx, world.truckA.locationId, world.p1), 17, "+10 only, today's stock never wiped");
    assert.equal((await movementsOf(tx, draft.id)).filter((m) => m.reason === INITIAL_LOAD_REPRISE_REASON).length, repriseBefore);
    const corrected = await lineOf(tx, draft.id, world.p1);
    assert.deepEqual([corrected.theoreticalRemainingQuantity, corrected.actualRemainingQuantity], [70, 58], "close figure 60 + 10");
    assert.equal(await gapOf(tx, draft.id, world.p1), -12);
    // removing the initial of a closed fiche: the load leaves, the old reprise is NOT given back
    await setStock(tx, world, world.truckA.locationId, world.p1, 100);
    await saveLines(tx, world, world.truckA, draft.id, [{ productId: world.p1, initial: 0, reload: 0, actual: null }]);
    assert.equal(await stockOf(tx, world.truckA.locationId, world.p1), 30, "100 - 70, nothing given back");
    assert.equal((await movementsOf(tx, draft.id)).filter((m) => m.reason === INITIAL_LOAD_REPRISE_REVERSAL_REASON).length, 1, "only the draft-time one");
  });
});

// 10 -----------------------------------------------------------------------------------------
test("several products and several trucks: a fiche only touches its own truck and products; another organisation is untouched", async (t) => {
  if (skipUnlessDb(t)) return;
  await inRollback(async (tx) => {
    const world = await makeWorld(tx);
    const other = await makeWorld(tx);
    await setStock(tx, world, world.truckA.locationId, world.p1, 50);
    await setStock(tx, world, world.truckA.locationId, world.p2, 8);
    await setStock(tx, world, world.truckB.locationId, world.p1, 33);
    await setStock(tx, other, other.truckA.locationId, other.p1, 50);
    const ficheA = await openFiche(tx, world, world.truckA);
    const ficheB = await openFiche(tx, world, world.truckB);
    await saveLines(tx, world, world.truckA, ficheA.id, [{ productId: world.p1, initial: 100, reload: 0 }]);
    await saveLines(tx, world, world.truckB, ficheB.id, [
      { productId: world.p1, initial: 0, reload: 5 },
      { productId: world.p2, initial: 12, reload: 0 },
    ]);
    assert.equal(await stockOf(tx, world.truckA.locationId, world.p1), 100);
    assert.equal(await stockOf(tx, world.truckA.locationId, world.p2), 8, "product not on fiche A: untouched");
    assert.equal(await stockOf(tx, world.truckB.locationId, world.p1), 38, "truck B: recharge only, added");
    assert.equal(await stockOf(tx, world.truckB.locationId, world.p2), 12, "truck B: initial 12 on an empty stock");
    assert.equal(await stockOf(tx, other.truckA.locationId, other.p1), 50, "other organisation untouched");
    const ficheMovements = await tx.stockMovement.findMany({ where: { referenceId: ficheA.id }, select: { sourceLocationId: true, destinationLocationId: true, productId: true } });
    for (const movement of ficheMovements) {
      assert.equal(movement.productId, world.p1);
      assert.ok([movement.sourceLocationId, movement.destinationLocationId].every((id) => id === world.truckA.locationId || id === world.depotLocationId));
    }
  });
});

// 11 -----------------------------------------------------------------------------------------
test("sales already made: the theoretical counts each movement once - truck stock, close figure and tour opening all agree", async (t) => {
  if (skipUnlessDb(t)) return;
  await inRollback(async (tx) => {
    const world = await makeWorld(tx);
    // yesterday: 50 left on the truck (loaded then partly sold)
    await setStock(tx, world, world.truckA.locationId, world.p1, 0);
    const yesterday = await openFiche(tx, world, world.truckA);
    await saveLines(tx, world, world.truckA, yesterday.id, [{ productId: world.p1, initial: 70, reload: 0 }]);
    await sell(tx, world, world.truckA, world.p1, 20);
    await closeFiche(tx, world.truckA, yesterday.id, { [world.p1]: 49 });
    assert.equal(await stockOf(tx, world.truckA.locationId, world.p1), 50, "the count 49 changed nothing");
    // today: initial 100 replaces the 50, recharge 30, 20 sold -> 110
    const today = await openFiche(tx, world, world.truckA);
    await saveLines(tx, world, world.truckA, today.id, [{ productId: world.p1, initial: 100, reload: 0 }]);
    await saveLines(tx, world, world.truckA, today.id, [{ productId: world.p1, initial: 100, reload: 30 }]);
    const todaysSale = await sell(tx, world, world.truckA, world.p1, 20);
    assert.equal(await stockOf(tx, world.truckA.locationId, world.p1), 110, "100 + 30 - 20");
    await closeFiche(tx, world.truckA, today.id, {});
    assert.equal((await lineOf(tx, today.id, world.p1)).theoreticalRemainingQuantity, 110);
    assert.equal(await gapOf(tx, today.id, world.p1), null, "not counted: no gap");

    // the /tournees sheet of a tour claiming "today": opening + loaded + reloaded - sold = the same 110
    const all = await tx.stockMovement.findMany({
      where: { organizationId: world.organizationId, OR: [{ sourceLocationId: world.truckA.locationId }, { destinationLocationId: world.truckA.locationId }] },
      select: { id: true, productId: true, quantity: true, sourceLocationId: true, destinationLocationId: true, referenceId: true, reason: true },
    });
    // the tour started before today's sale: opening = every truck movement except today's fiche (excluded by id) and that sale
    const todaysSales = all.filter((m) => m.id === todaysSale.id);
    const opening = openingQuantitiesByProduct({
      truckLocationId: world.truckA.locationId,
      ownLoadingId: today.id,
      movementsBeforeTour: all.filter((m) => !todaysSales.includes(m)),
      ownLoadingReprises: all.filter((m) => m.referenceId === today.id && m.reason?.startsWith("Reprise")),
    });
    assert.equal(opening.get(world.p1), 0, "the old 50 left the opening figure with the reprise");
    const sheetTheoretical = (opening.get(world.p1) ?? 0) + 100 + 30 - 20;
    assert.equal(sheetTheoretical, await stockOf(tx, world.truckA.locationId, world.p1));
  });
});

// 13 -----------------------------------------------------------------------------------------
test("historical transfers: closed fiches keep their figures and gap, their old adjustments are untouched, an already-applied draft is never replaced afterwards", async (t) => {
  if (skipUnlessDb(t)) return;
  await inRollback(async (tx) => {
    const world = await makeWorld(tx);
    // an OLD closed fiche (previous rules: additive charge + INVENTORY_ADJUSTMENT at the close)
    const old = await openFiche(tx, world, world.truckA);
    await tx.truckLoadingLine.create({ data: { loadingId: old.id, productId: world.p1, quantity: 40, reloadedQuantity: 0, theoreticalRemainingQuantity: 30, actualRemainingQuantity: 27 } });
    await tx.stockMovement.create({
      data: {
        organizationId: world.organizationId,
        movementNumber: `MV-OLD-${uid()}`,
        type: "INVENTORY_ADJUSTMENT",
        productId: world.p1,
        quantity: 3,
        sourceLocationId: world.truckA.locationId,
        referenceType: "TRUCK_LOADING",
        referenceId: old.id,
        reason: "Cloture chargement - ajustement stock reel",
        createdByUserId: world.userId,
        status: "VALIDATED",
      },
    });
    await tx.truckLoading.update({ where: { id: old.id }, data: { status: "VALIDATED", stockAppliedAt: new Date(), validatedAt: new Date() } });
    assert.equal(await gapOf(tx, old.id, world.p1), -3, "same gap as the adjustment recorded then");
    await setStock(tx, world, world.truckA.locationId, world.p1, 12);
    await saveLines(tx, world, world.truckA, old.id, [{ productId: world.p1, initial: 40, reload: 0, actual: 27 }]);
    assert.equal(await stockOf(tx, world.truckA.locationId, world.p1), 12, "re-saving an old closed fiche moves nothing");
    assert.equal(await tx.stockMovement.count({ where: { referenceId: old.id } }), 1, "its old adjustment is untouched");
    assert.equal((await lineOf(tx, old.id, world.p1)).theoreticalRemainingQuantity, 30);

    // a draft whose initial was applied BEFORE this change (additive): never replaced afterwards
    const draft = await openFiche(tx, world, world.truckB);
    await setStock(tx, world, world.truckB.locationId, world.p1, 150); // old rule: 50 + 100
    await tx.truckLoadingLine.create({ data: { loadingId: draft.id, productId: world.p1, quantity: 100, reloadedQuantity: 0 } });
    await tx.truckLoading.update({ where: { id: draft.id }, data: { stockAppliedAt: new Date() } });
    await saveLines(tx, world, world.truckB, draft.id, [{ productId: world.p1, initial: 100, reload: 5 }]);
    assert.equal(await stockOf(tx, world.truckB.locationId, world.p1), 155, "only the +5 recharge, no late reprise");
    assert.equal((await movementsOf(tx, draft.id)).some((m) => m.reason === INITIAL_LOAD_REPRISE_REASON), false);
  });
});

test("negative truck stock is brought back to 0 by the reprise (depot -> truck), then replaced", async (t) => {
  if (skipUnlessDb(t)) return;
  await inRollback(async (tx) => {
    const world = await makeWorld(tx);
    await setStock(tx, world, world.truckA.locationId, world.p1, -5);
    await setStock(tx, world, world.depotLocationId, world.p1, 100);
    const fiche = await openFiche(tx, world, world.truckA);
    await saveLines(tx, world, world.truckA, fiche.id, [{ productId: world.p1, initial: 40, reload: 0 }]);
    assert.equal(await stockOf(tx, world.truckA.locationId, world.p1), 40);
    assert.equal(await stockOf(tx, world.depotLocationId, world.p1), 100 - 5 - 40);
    const [reprise] = await movementsOf(tx, fiche.id);
    assert.deepEqual([reprise.reason, reprise.quantity, reprise.sourceLocationId], [INITIAL_LOAD_REPRISE_REASON, 5, world.depotLocationId]);
  });
});

// wiring of the real services (lib/server/truck-loadings.ts) ---------------------------------
test("services: open fiches replace, closed fiches are corrected by differences, counts never write stock", () => {
  const source = readFileSync(new URL("./truck-loadings.ts", import.meta.url), "utf8");
  const body = (name: string) => source.slice(source.indexOf(`export async function ${name}(`)).split(/\nexport (?:async )?function /)[0];
  for (const name of ["updateOpenLoadingLines", "closeLoading", "createLoading", "updateDraftLoading", "cancelDraftLoading", "validateLoading"]) {
    assert.match(body(name), /replaceInitial: true,/, `${name}: an open fiche`);
  }
  assert.match(body("updateLoadingLines"), /replaceInitial: current\.status === "DRAFT",/);
  assert.match(body("closeLoading"), /truckLoadingCloseSchema\.safeParse/);
  assert.match(body("closeLoading"), /recordRemainingCounts\(tx,/);
  for (const name of ["closeLoading", "updateLoadingLines", "validateLoading"]) {
    assert.doesNotMatch(body(name), /INVENTORY_ADJUSTMENT|stockLevel\.(upsert|update)\(/, `${name}: no stock write from a count`);
  }
  assert.doesNotMatch(body("closeLoading"), /Veuillez saisir la quantite restante reelle/, "the close no longer requires every count");
  assert.doesNotMatch(source, /async function applyActualRemainingQuantitiesOnLine|async function applyLoadingStockDelta/, "one implementation, in the core");
  assert.match(source, /nextMovementNumber: \(tx, organizationId\) => nextMovementNumber\(tx, organizationId\)/);
  // still one transaction per action, Serializable, retried
  for (const name of ["updateOpenLoadingLines", "closeLoading", "updateLoadingLines", "cancelDraftLoading"]) {
    assert.match(body(name), /withLoadingSerializableRetry\(\(\) =>\s*prisma\.\$transaction\(/, name);
    assert.match(body(name), /isolationLevel: "Serializable"/, name);
  }
});
