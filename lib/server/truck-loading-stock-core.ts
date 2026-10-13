import type { Prisma } from "@/lib/generated/prisma/client";
import { OperationsServiceError } from "@/lib/server/service-error";

/**
 * Stock side of the "transferts de stock" (TruckLoading), with the database
 * client injected - the real transaction of lib/server/truck-loadings.ts, or a
 * rolled-back one in the tests - and the movement-number generator injected
 * too (it lives in a server-only module). Every call runs INSIDE the caller's
 * Serializable transaction, which also rewrites the fiche's lines: the
 * "previous" state read here is therefore always the state the next attempt
 * re-reads, so a retry or a double click never applies a quantity twice.
 *
 * Rules (per product of a fiche):
 *  - Charge initiale REPLACES the truck stock. The first time a non-zero
 *    initial load is applied on an OPEN fiche, the truck's previous stock of
 *    that product (what the truck holds that this fiche did not bring) is taken
 *    back to the depot ("reprise", one movement truck -> depot), then the load
 *    itself moves depot -> truck as before. Ex.: truck 50, initial 100 ->
 *    reprise 50, load 100, truck 100, depot net -50.
 *  - Recharge is ADDED to the truck stock (plain depot -> truck delta).
 *  - Editing an applied initial load only moves the difference (100 -> 120:
 *    +20); the reprise is never repeated. Bringing it back to 0 (line removed,
 *    fiche cancelled) gives the reprise back exactly.
 *  - A CLOSED fiche is never "replaced" again: correcting it moves plain
 *    differences only, so an old fiche can never wipe today's truck stock.
 *  - Restant reel is a COUNT only: recorded with the theoretical stock of the
 *    moment, it never writes StockLevel nor StockMovement.
 */

type Db = Prisma.TransactionClient;

export type LoadingSequences = {
  nextMovementNumber(tx: Db, organizationId: string): Promise<string>;
};

export const LOADING_APPLIED_REASON = "Chargement brouillon applique";
export const LOADING_CORRECTION_REASON = "Correction de chargement brouillon";
export const INITIAL_LOAD_REPRISE_REASON = "Reprise de l'ancien stock camion (charge initiale)";
export const INITIAL_LOAD_REPRISE_REVERSAL_REASON = "Annulation de la reprise de l'ancien stock camion";
const REPRISE_REASONS = [INITIAL_LOAD_REPRISE_REASON, INITIAL_LOAD_REPRISE_REVERSAL_REASON];

/** True for the reprise / reprise-reversal movements of a charge initiale. */
export function isInitialLoadRepriseReason(reason: string | null | undefined): boolean {
  return reason != null && REPRISE_REASONS.includes(reason);
}

export type PersistedLoadingLine = {
  productId: string;
  quantity: number;
  reloadedQuantity: number;
};

export type NormalizedLoadingLineInput = {
  productId: string;
  initialQuantity: number;
  reloadedQuantity: number;
  quantity: number;
  /** "Restante reelle" typed on a still-open fiche; null/omitted = not counted
   * yet (kept distinct from a real 0). Never used by the stock helpers. */
  actualRemainingQuantity?: number | null;
};

/** The charge initiale stored on a line (quantity = charge initiale + recharge). */
export function initialQuantityOf(line: PersistedLoadingLine): number {
  return Math.max(0, line.quantity - line.reloadedQuantity);
}

type StockDeltaInput = {
  loadingId: string;
  loadingNumber: string;
  depotLocationId: string;
  truckLocationId: string;
  previousLines: PersistedLoadingLine[];
  nextLines: NormalizedLoadingLineInput[];
  stockAlreadyApplied: boolean;
  /** true on an OPEN (DRAFT) fiche: a newly applied charge initiale replaces the truck stock. */
  replaceInitial: boolean;
  organizationId: string;
  userId: string;
  sequences: LoadingSequences;
};

export async function applyLoadingStockDelta(tx: Db, input: StockDeltaInput) {
  const previousLineByProductId = new Map(input.previousLines.map((line) => [line.productId, line]));
  const nextLineByProductId = new Map(input.nextLines.map((line) => [line.productId, line]));
  const productIds = [...new Set([...previousLineByProductId.keys(), ...nextLineByProductId.keys()])];

  for (const productId of productIds) {
    const previousLine = previousLineByProductId.get(productId);
    const nextLine = nextLineByProductId.get(productId);
    const previousAppliedQuantity = input.stockAlreadyApplied ? (previousLine?.quantity ?? 0) : 0;
    const previousAppliedInitial = input.stockAlreadyApplied && previousLine ? initialQuantityOf(previousLine) : 0;
    const nextInitial = nextLine?.initialQuantity ?? 0;

    // The reprise (or giving it back) always comes BEFORE the load delta: when an
    // initial load is removed, the truck first gets its old stock back, then the
    // load leaves - so a truck that sold part of the day can still be corrected.
    if (input.replaceInitial && previousAppliedInitial === 0 && nextInitial > 0) {
      await takeBackOldTruckStock(tx, input, productId, previousAppliedQuantity);
    } else if (input.replaceInitial && previousAppliedInitial > 0 && nextInitial === 0) {
      await giveBackOldTruckStock(tx, input, productId);
    }

    const nextQuantity = nextLine?.quantity ?? 0;
    const deltaQuantity = nextQuantity - previousAppliedQuantity;
    if (deltaQuantity === 0) continue;

    if (deltaQuantity > 0) {
      // A depot -> truck loading is never blocked by low/zero/negative depot
      // stock: the depot StockLevel is allowed to go negative (an anomaly to
      // flag, not an invariant). The reverse move below keeps its own guard -
      // reducing a loading still requires the truck to hold the stock sent back.
      await moveStock(tx, input, productId, input.depotLocationId, input.truckLocationId, deltaQuantity);
    } else {
      const reverseQuantity = Math.abs(deltaQuantity);
      const truckLevel = await tx.stockLevel.findUnique({
        where: { productId_locationId: { productId, locationId: input.truckLocationId } },
      });
      const truckAvailable = (truckLevel?.quantity ?? 0) - (truckLevel?.reservedQuantity ?? 0);
      if (!truckLevel || truckAvailable < reverseQuantity) {
        throw new OperationsServiceError(
          "Le camion ne possede pas assez de stock pour reduire ce transfert de stock.",
          422,
          { [productId]: "Le camion ne possede pas assez de stock pour reduire ce transfert de stock." },
        );
      }
      await moveStock(tx, input, productId, input.truckLocationId, input.depotLocationId, reverseQuantity);
    }

    await tx.stockMovement.create({
      data: {
        organizationId: input.organizationId,
        movementNumber: await input.sequences.nextMovementNumber(tx, input.organizationId),
        type: "TRUCK_LOADING",
        productId,
        quantity: Math.abs(deltaQuantity),
        sourceLocationId: deltaQuantity > 0 ? input.depotLocationId : input.truckLocationId,
        destinationLocationId: deltaQuantity > 0 ? input.truckLocationId : input.depotLocationId,
        referenceType: "TRUCK_LOADING",
        referenceId: input.loadingId,
        reason: deltaQuantity > 0 ? LOADING_APPLIED_REASON : LOADING_CORRECTION_REASON,
        note: buildLoadingMovementNote({ loadingNumber: input.loadingNumber, previousLine, nextLine, deltaQuantity }),
        createdByUserId: input.userId,
        status: "VALIDATED",
      },
    });
  }
}

/** quantity > 0 moves from -> to; both StockLevels are created when missing. */
async function moveStock(
  tx: Db,
  input: Pick<StockDeltaInput, "organizationId">,
  productId: string,
  fromLocationId: string,
  toLocationId: string,
  quantity: number,
) {
  await tx.stockLevel.upsert({
    where: { productId_locationId: { productId, locationId: fromLocationId } },
    update: { quantity: { decrement: quantity } },
    create: { organizationId: input.organizationId, productId, locationId: fromLocationId, quantity: -quantity, reservedQuantity: 0 },
  });
  await tx.stockLevel.upsert({
    where: { productId_locationId: { productId, locationId: toLocationId } },
    update: { quantity: { increment: quantity } },
    create: { organizationId: input.organizationId, productId, locationId: toLocationId, quantity, reservedQuantity: 0 },
  });
}

/**
 * Reprise: what the truck holds of this product that this fiche did not bring
 * (current truck stock minus what the fiche already applied, e.g. a recharge
 * typed before the initial load) goes back to the depot. A negative truck stock
 * is brought back to 0 the same way (depot -> truck). Nothing when it is 0.
 */
async function takeBackOldTruckStock(tx: Db, input: StockDeltaInput, productId: string, alreadyAppliedByThisFiche: number) {
  const truckLevel = await tx.stockLevel.findUnique({
    where: { productId_locationId: { productId, locationId: input.truckLocationId } },
    select: { quantity: true },
  });
  const truckQuantity = truckLevel?.quantity ?? 0;
  const oldStock = truckQuantity - alreadyAppliedByThisFiche;
  if (oldStock === 0) return;

  const toDepot = oldStock > 0;
  await moveStock(
    tx,
    input,
    productId,
    toDepot ? input.truckLocationId : input.depotLocationId,
    toDepot ? input.depotLocationId : input.truckLocationId,
    Math.abs(oldStock),
  );
  await tx.stockMovement.create({
    data: {
      organizationId: input.organizationId,
      movementNumber: await input.sequences.nextMovementNumber(tx, input.organizationId),
      type: "TRUCK_LOADING",
      productId,
      quantity: Math.abs(oldStock),
      sourceLocationId: toDepot ? input.truckLocationId : input.depotLocationId,
      destinationLocationId: toDepot ? input.depotLocationId : input.truckLocationId,
      referenceType: "TRUCK_LOADING",
      referenceId: input.loadingId,
      reason: INITIAL_LOAD_REPRISE_REASON,
      note: JSON.stringify({
        loadingNumber: input.loadingNumber,
        kind: "INITIAL_LOAD_REPRISE",
        truckQuantityBefore: truckQuantity,
        appliedByThisLoading: alreadyAppliedByThisFiche,
        repriseQuantity: oldStock,
      }),
      createdByUserId: input.userId,
      status: "VALIDATED",
    },
  });
}

/**
 * The exact opposite of every reprise already recorded for this fiche and
 * product (net of any earlier give-back): the truck gets its old stock back.
 * Read from the movements themselves, so it is exact whatever happened since.
 */
async function giveBackOldTruckStock(tx: Db, input: StockDeltaInput, productId: string) {
  const movements = await tx.stockMovement.findMany({
    where: {
      organizationId: input.organizationId,
      referenceType: "TRUCK_LOADING",
      referenceId: input.loadingId,
      productId,
      reason: { in: REPRISE_REASONS },
    },
    select: { quantity: true, sourceLocationId: true },
  });
  // > 0: stock still taken out of the truck by this fiche's reprise.
  const takenFromTruck = movements.reduce(
    (sum, movement) => sum + (movement.sourceLocationId === input.truckLocationId ? movement.quantity : -movement.quantity),
    0,
  );
  if (takenFromTruck === 0) return;

  const toTruck = takenFromTruck > 0;
  await moveStock(
    tx,
    input,
    productId,
    toTruck ? input.depotLocationId : input.truckLocationId,
    toTruck ? input.truckLocationId : input.depotLocationId,
    Math.abs(takenFromTruck),
  );
  await tx.stockMovement.create({
    data: {
      organizationId: input.organizationId,
      movementNumber: await input.sequences.nextMovementNumber(tx, input.organizationId),
      type: "TRUCK_LOADING",
      productId,
      quantity: Math.abs(takenFromTruck),
      sourceLocationId: toTruck ? input.depotLocationId : input.truckLocationId,
      destinationLocationId: toTruck ? input.truckLocationId : input.depotLocationId,
      referenceType: "TRUCK_LOADING",
      referenceId: input.loadingId,
      reason: INITIAL_LOAD_REPRISE_REVERSAL_REASON,
      note: JSON.stringify({ loadingNumber: input.loadingNumber, kind: "INITIAL_LOAD_REPRISE_REVERSAL", givenBackQuantity: takenFromTruck }),
      createdByUserId: input.userId,
      status: "VALIDATED",
    },
  });
}

function buildLoadingMovementNote({
  loadingNumber,
  previousLine,
  nextLine,
  deltaQuantity,
}: {
  loadingNumber: string;
  previousLine?: PersistedLoadingLine;
  nextLine?: NormalizedLoadingLineInput;
  deltaQuantity: number;
}) {
  return JSON.stringify({
    loadingNumber,
    previousInitialQuantity: previousLine ? initialQuantityOf(previousLine) : 0,
    previousReloadedQuantity: previousLine?.reloadedQuantity ?? 0,
    nextInitialQuantity: nextLine?.initialQuantity ?? 0,
    nextReloadedQuantity: nextLine?.reloadedQuantity ?? 0,
    deltaQuantity,
  });
}

/**
 * "Restant reel" of the fiche's products: each line keeps the theoretical
 * stock of the moment (the truck StockLevel - charge initiale + recharges -
 * sales +/- every other recorded movement, each counted once) next to the
 * count. null = not counted (never 0). NO StockLevel / StockMovement write.
 */
export async function recordRemainingCounts(
  tx: Db,
  input: {
    loadingId: string;
    truckLocationId: string;
    lines: Array<{ productId: string; actualRemainingQuantity: number | null }>;
  },
): Promise<Array<{ productId: string; theoreticalRemainingQuantity: number; actualRemainingQuantity: number | null }>> {
  const levels = input.lines.length
    ? await tx.stockLevel.findMany({
        where: { locationId: input.truckLocationId, productId: { in: input.lines.map((line) => line.productId) } },
        select: { productId: true, quantity: true },
      })
    : [];
  const quantityByProductId = new Map(levels.map((level) => [level.productId, level.quantity]));
  const recorded = [];
  for (const line of input.lines) {
    const theoreticalRemainingQuantity = quantityByProductId.get(line.productId) ?? 0;
    await tx.truckLoadingLine.upsert({
      where: { loadingId_productId: { loadingId: input.loadingId, productId: line.productId } },
      update: { theoreticalRemainingQuantity, actualRemainingQuantity: line.actualRemainingQuantity },
      create: {
        loadingId: input.loadingId,
        productId: line.productId,
        quantity: 0,
        reloadedQuantity: 0,
        theoreticalRemainingQuantity,
        actualRemainingQuantity: line.actualRemainingQuantity,
      },
    });
    recorded.push({ productId: line.productId, theoreticalRemainingQuantity, actualRemainingQuantity: line.actualRemainingQuantity });
  }
  return recorded;
}

/**
 * Correction of a CLOSED fiche: the theoretical figured at the close follows
 * the corrected quantities (charge 100 -> 110 = theoretical + 10), it is never
 * replaced by today's truck stock. A product added to the closed fiche has no
 * close figure: it takes the truck stock of now. Counts are stored as given
 * (null = not counted). No stock write.
 */
export function shiftedTheoreticalSnapshots(
  previous: Array<{ productId: string; quantity: number; theoreticalRemainingQuantity: number | null }>,
  next: Array<{ productId: string; quantity: number }>,
  liveTruckQuantity: (productId: string) => number,
): Map<string, number> {
  const previousByProductId = new Map(previous.map((line) => [line.productId, line]));
  return new Map(
    next.map((line) => {
      const before = previousByProductId.get(line.productId);
      return [
        line.productId,
        before && before.theoreticalRemainingQuantity !== null
          ? before.theoreticalRemainingQuantity + (line.quantity - before.quantity)
          : liveTruckQuantity(line.productId),
      ];
    }),
  );
}

/**
 * Opening stock of a tour (lib/server/tours.ts#getTourStockSheet): every truck
 * movement before the tour started, EXCEPT its own loading's (counted from the
 * loading lines instead) - but INCLUDING its own loading's reprise / give-back,
 * whenever they happened: the charge initiale replaced that old stock, so it
 * must leave the opening figure, or the sheet would count it twice.
 */
export function openingQuantitiesByProduct(input: {
  truckLocationId: string;
  ownLoadingId: string | null;
  movementsBeforeTour: Array<{ productId: string; quantity: number; sourceLocationId: string | null; destinationLocationId: string | null; referenceId: string | null }>;
  ownLoadingReprises: Array<{ productId: string; quantity: number; sourceLocationId: string | null; destinationLocationId: string | null }>;
}): Map<string, number> {
  const opening = new Map<string, number>();
  const add = (movement: { productId: string; quantity: number; sourceLocationId: string | null; destinationLocationId: string | null }) => {
    const delta =
      (movement.destinationLocationId === input.truckLocationId ? movement.quantity : 0) -
      (movement.sourceLocationId === input.truckLocationId ? movement.quantity : 0);
    opening.set(movement.productId, (opening.get(movement.productId) ?? 0) + delta);
  };
  for (const movement of input.movementsBeforeTour) {
    if (input.ownLoadingId && movement.referenceId === input.ownLoadingId) continue;
    add(movement);
  }
  for (const movement of input.ownLoadingReprises) add(movement);
  return opening;
}
