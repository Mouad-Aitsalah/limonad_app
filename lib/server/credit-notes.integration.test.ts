import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import type { PrismaClient } from "@/lib/generated/prisma/client";
import type { CurrentUser } from "@/types/auth";
import type { CreateCreditNoteInput } from "@/types/credit-note";

/**
 * Lot 1 (avoirs) - the REAL desk credit-note code (lib/server/credit-notes.ts: the
 * real Prisma client, the real Serializable transactions, the real stock movements
 * and the real accounting entries) against a THROWAWAY PostgreSQL database.
 *
 * Safety: the file does nothing unless D2_TEST_DATABASE_URL names the local database
 * `commdis_d2_test` AND DATABASE_URL (what the shared Prisma client uses) is that very
 * URL. Run it with the wrapper that creates the database, applies every migration and
 * ALWAYS drops it. Each test makes its own organisation, so tests never share data.
 */

const D2 = process.env.D2_TEST_DATABASE_URL;
function isThrowaway(url: string | undefined): boolean {
  if (!url || process.env.DATABASE_URL !== url) return false;
  try {
    const parsed = new URL(url);
    return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname) && parsed.port === "5432" && parsed.pathname === "/commdis_d2_test";
  } catch {
    return false;
  }
}
const enabled = isThrowaway(D2);
const SKIP = enabled ? false : "D2_TEST_DATABASE_URL is not the throwaway database commdis_d2_test (use the wrapper)";

type CreditNotes = typeof import("@/lib/server/credit-notes");
let prisma: PrismaClient;
let notes: CreditNotes;

before(async () => {
  if (!enabled) return;
  prisma = (await import("@/lib/prisma")).prisma;
  notes = await import("@/lib/server/credit-notes");
  const row = await prisma.$queryRaw<Array<{ db: string }>>`select current_database() as db`;
  assert.equal(row[0].db, "commdis_d2_test", "connected to the throwaway database");
});

after(async () => {
  if (enabled) await prisma.$disconnect().catch(() => undefined);
});

const uid = () => randomUUID().replace(/-/g, "").slice(0, 10);

// ---- fixtures -----------------------------------------------------------------------------------------

type Role = "admin" | "depot_manager" | "cashier" | "driver";
const PRISMA_ROLE = { admin: "ADMIN", depot_manager: "DEPOT_MANAGER", cashier: "CASHIER", driver: "DRIVER" } as const;

async function makeOrg(label: string) {
  const suffix = uid();
  const organization = await prisma.organization.create({ data: { code: `AV-${label}-${suffix}`.toUpperCase(), name: `Avoirs ${label}` } });
  const users = {} as Record<Role, CurrentUser>;
  for (const role of Object.keys(PRISMA_ROLE) as Role[]) {
    const user = await prisma.user.create({
      data: {
        organizationId: organization.id,
        firstName: role,
        lastName: label,
        fullName: `${role} ${label}`,
        email: `av-${role}-${suffix}@example.invalid`,
        passwordHash: "x",
        role: PRISMA_ROLE[role],
      },
    });
    users[role] = { id: user.id, nom: user.fullName, email: user.email, role, organizationId: organization.id };
  }
  const depotRow = await prisma.depot.create({ data: { organizationId: organization.id, code: `D-${suffix}`, name: "Depot principal", address: "-", city: "-" } });
  const depot = await prisma.stockLocation.create({ data: { organizationId: organization.id, code: `D-${suffix}`, name: "Depot principal", type: "DEPOT", depotId: depotRow.id } });
  const truckRow = await prisma.truck.create({ data: { organizationId: organization.id, code: `T-${suffix}`, registration: `REG-${suffix}`, depotId: depotRow.id } });
  const truck = await prisma.stockLocation.create({ data: { organizationId: organization.id, code: `T-${suffix}`, name: "Camion 1", type: "TRUCK", truckId: truckRow.id } });
  const category = await prisma.category.create({ data: { organizationId: organization.id, name: "Boissons" } });
  const supplier = await prisma.supplier.create({ data: { organizationId: organization.id, code: `F-${suffix}`, name: "Fournisseur 1" } });
  const product = await prisma.product.create({
    data: {
      organizationId: organization.id,
      reference: `P-${suffix}`,
      name: "Sidi Ali 2 L",
      categoryId: category.id,
      defaultSupplierId: supplier.id,
      purchasePrice: 12.5,
      salePrice: 100,
      taxRate: 20,
      unit: "unite",
    },
  });
  const customer = await prisma.customer.create({
    data: {
      organizationId: organization.id,
      code: `C-${suffix}`,
      name: "Client test",
      address: "-",
      city: "-",
      type: "GROCERY",
      createdByUserId: users.admin.id,
      creationOrigin: "ADMIN",
    },
  });
  return { id: organization.id, users, depotId: depot.id, truckId: truck.id, productId: product.id, customerId: customer.id, supplierId: supplier.id };
}
type Org = Awaited<ReturnType<typeof makeOrg>>;

function customerInput(org: Org, over: Partial<CreateCreditNoteInput> = {}): CreateCreditNoteInput {
  return {
    partyType: "client",
    customerId: org.customerId,
    returnMode: "MANUAL",
    reason: "produit_endommage",
    comment: "Bouteilles abimees a la livraison",
    returnDate: new Date().toISOString().slice(0, 10),
    stockDestinationLocationId: org.depotId,
    lines: [{ productId: org.productId, quantityReturned: 3 }],
    idempotencyKey: randomUUID(),
    ...over,
  };
}

function supplierInput(org: Org, over: Partial<CreateCreditNoteInput> = {}): CreateCreditNoteInput {
  return {
    partyType: "fournisseur",
    supplierId: org.supplierId,
    reason: "produit_defectueux",
    comment: "",
    returnDate: new Date().toISOString().slice(0, 10),
    stockSourceLocationId: org.depotId,
    lines: [{ productId: org.productId, quantityReturned: 2, unitPrice: 12.5, discountPercent: 0, taxRate: 20 }],
    idempotencyKey: randomUUID(),
    ...over,
  };
}

const stockOf = async (productId: string, locationId: string) =>
  (await prisma.stockLevel.findUnique({ where: { productId_locationId: { productId, locationId } } }))?.quantity ?? 0;

async function entriesFor(org: Org, sourceId: string) {
  return prisma.accountingEntry.findMany({
    where: { organizationId: org.id, sourceId },
    include: { lines: { include: { account: { select: { code: true } } } } },
    orderBy: { createdAt: "asc" },
  });
}

function assertBalanced(entry: { lines: Array<{ debit: { toNumber(): number }; credit: { toNumber(): number } }> }) {
  const debit = entry.lines.reduce((sum, line) => sum + line.debit.toNumber(), 0);
  const credit = entry.lines.reduce((sum, line) => sum + line.credit.toNumber(), 0);
  assert.equal(Math.round(debit * 100), Math.round(credit * 100), "the entry is balanced");
}

/** Rejects with an error carrying this HTTP status (OperationsServiceError / AuthServiceError). */
async function rejectsWith(promise: Promise<unknown>, status: number, message?: RegExp) {
  await assert.rejects(promise, (error: unknown) => {
    const failure = error as { status?: number; message?: string };
    assert.equal(failure.status, status, `status ${failure.status}: ${failure.message}`);
    if (message) assert.match(failure.message ?? "", message);
    return true;
  });
}

// ---- roles and justification -----------------------------------------------------------------------------

test("the cashier creates a manual customer credit note: validated, cash refund by default, depot stock credited, balanced cash entry", { skip: SKIP }, async () => {
  const org = await makeOrg("cashier");
  const note = await notes.createManualCreditNoteAs(org.users.cashier, customerInput(org));

  assert.equal(note.status, "VALIDE");
  assert.equal(note.refundMode, "remboursement_especes", "cash refund is the default");
  assert.equal(note.stockDestinationLocationId, org.depotId);
  assert.equal(await stockOf(org.productId, org.depotId), 3, "the whole returned quantity is back in the depot");
  assert.equal(await stockOf(org.productId, org.truckId), 0, "the truck is never touched");

  const movements = await prisma.stockMovement.findMany({ where: { organizationId: org.id, referenceId: note.id } });
  assert.equal(movements.length, 1);
  assert.equal(movements[0].type, "CUSTOMER_RETURN");
  assert.equal(movements[0].quantity, 3);
  assert.equal(movements[0].destinationLocationId, org.depotId);
  assert.equal(movements[0].referenceType, "CREDIT_NOTE");

  const entries = await entriesFor(org, note.id);
  assert.equal(entries.length, 1, "one accounting entry");
  assertBalanced(entries[0]);
  const cashLine = entries[0].lines.find((line) => line.account.code === "51611");
  assert.ok(cashLine, "the till (51611) is credited");
  assert.equal(cashLine.credit.toNumber(), note.totalTTC);
});

test("only the administrator and the cashier create a customer note; the depot manager and the driver may not", { skip: SKIP }, async () => {
  const org = await makeOrg("roles");
  for (const role of ["admin", "cashier"] as const) {
    const note = await notes.createManualCreditNoteAs(org.users[role], customerInput(org));
    assert.equal(note.status, "VALIDE", role);
  }
  const before = await prisma.creditNote.count({ where: { organizationId: org.id } });
  for (const role of ["depot_manager", "driver"] as const) {
    await rejectsWith(notes.createManualCreditNoteAs(org.users[role], customerInput(org)), 403);
    await rejectsWith(notes.saveCreditNoteDraftAs(org.users[role], customerInput(org)), 403);
  }
  assert.equal(await prisma.creditNote.count({ where: { organizationId: org.id } }), before, "nothing was written by the refused roles");
});

test("the depot manager can neither validate a draft nor use the returnables helper, but still reverses", { skip: SKIP }, async () => {
  const org = await makeOrg("dm-validate");
  const draft = await notes.saveCreditNoteDraftAs(org.users.admin, customerInput(org));
  await rejectsWith(notes.validateCreditNoteAs(org.users.depot_manager, draft.id), 403);
  assert.equal((await prisma.creditNote.findUniqueOrThrow({ where: { id: draft.id } })).status, "DRAFT");
  const validated = await notes.validateCreditNoteAs(org.users.cashier, draft.id);
  assert.equal(validated.status, "VALIDE");
  assert.equal((await notes.reverseCreditNoteAs(org.users.depot_manager, validated.id)).status, "CONTREPASSE");
});

test("a customer note without a real justification is refused server-side, for every role; nothing is written", { skip: SKIP }, async () => {
  const org = await makeOrg("justif");
  for (const comment of ["", "   ", "abc", null]) {
    await rejectsWith(notes.createManualCreditNoteAs(org.users.cashier, customerInput(org, { comment })), 422, /justification est obligatoire/);
  }
  await rejectsWith(notes.createManualCreditNoteAs(org.users.admin, customerInput(org, { comment: "ok" })), 422, /justification/);
  await rejectsWith(notes.saveCreditNoteDraftAs(org.users.cashier, customerInput(org, { comment: "" })), 422, /justification/);
  assert.equal(await prisma.creditNote.count({ where: { organizationId: org.id } }), 0);
  assert.equal(await stockOf(org.productId, org.depotId), 0);
});

// ---- price lock --------------------------------------------------------------------------------------------

test("the cashier's manual price is locked server-side to the product's current sale price, whatever the browser sends", { skip: SKIP }, async () => {
  const org = await makeOrg("lock");
  const note = await notes.createManualCreditNoteAs(
    org.users.cashier,
    customerInput(org, { lines: [{ productId: org.productId, quantityReturned: 3, unitPrice: 999, discountPercent: 50, taxRate: 0 }] }),
  );
  const [line] = note.lines;
  assert.equal(line.unitPrice, 100, "salePrice HT of the product");
  assert.equal(line.discountPercent, 0);
  assert.equal(line.taxRate, 20, "the product's VAT");
  assert.equal(line.totalTTC, 360, "3 x 100 HT x 1.20");
  assert.equal(note.totalTTC, 360);

  const audit = await prisma.auditLog.findFirst({ where: { organizationId: org.id, entityId: note.id } });
  const logged = audit?.newValue as { priceLockedToCatalogue?: boolean; clientPricingIgnoredProductIds?: string[] };
  assert.equal(logged.priceLockedToCatalogue, true);
  assert.deepEqual(logged.clientPricingIgnoredProductIds, [org.productId], "the ignored browser price is recorded");

  // Sending the right price is not reported as a tampering.
  const clean = await notes.createManualCreditNoteAs(
    org.users.cashier,
    customerInput(org, { lines: [{ productId: org.productId, quantityReturned: 1, unitPrice: 100, discountPercent: 0, taxRate: 20 }] }),
  );
  const cleanAudit = await prisma.auditLog.findFirst({ where: { organizationId: org.id, entityId: clean.id } });
  assert.equal((cleanAudit?.newValue as { clientPricingIgnoredProductIds?: string[] }).clientPricingIgnoredProductIds, undefined);
});

test("the cashier's draft is priced the same way, and stays so when a cashier validates it", { skip: SKIP }, async () => {
  const org = await makeOrg("lockdraft");
  const draft = await notes.saveCreditNoteDraftAs(
    org.users.cashier,
    customerInput(org, { lines: [{ productId: org.productId, quantityReturned: 2, unitPrice: 1, discountPercent: 90 }] }),
  );
  assert.equal(draft.status, "BROUILLON");
  assert.equal(draft.lines[0].unitPrice, 100);
  assert.equal(await stockOf(org.productId, org.depotId), 0, "a draft moves no stock");
  const validated = await notes.validateCreditNoteAs(org.users.cashier, draft.id);
  assert.equal(validated.status, "VALIDE");
  assert.equal(validated.totalTTC, 240);
  assert.equal(await stockOf(org.productId, org.depotId), 2);
});

test("the admin keeps the manual price", { skip: SKIP }, async () => {
  const org = await makeOrg("free");
  for (const role of ["admin"] as const) {
    const note = await notes.createManualCreditNoteAs(
      org.users[role],
      customerInput(org, { lines: [{ productId: org.productId, quantityReturned: 1, unitPrice: 80, discountPercent: 10, taxRate: 20 }] }),
    );
    assert.equal(note.lines[0].unitPrice, 80, role);
    assert.equal(note.lines[0].discountPercent, 10, role);
    assert.equal(note.totalTTC, 86.4, `${role}: 80 x 0.9 = 72 HT, 86.40 TTC`);
  }
});

// ---- depot only ----------------------------------------------------------------------------------------------

test("a truck is refused as the destination of a customer note: no note, no stock, no entry", { skip: SKIP }, async () => {
  const org = await makeOrg("truck");
  for (const role of ["cashier", "admin"] as const) {
    await rejectsWith(
      notes.createManualCreditNoteAs(org.users[role], customerInput(org, { stockDestinationLocationId: org.truckId })),
      422,
      /depot \(camion refuse\)/,
    );
    await rejectsWith(
      notes.saveCreditNoteDraftAs(org.users[role], customerInput(org, { stockDestinationLocationId: org.truckId })),
      422,
      /camion refuse/,
    );
  }
  assert.equal(await prisma.creditNote.count({ where: { organizationId: org.id } }), 0);
  assert.equal(await stockOf(org.productId, org.truckId), 0);
  assert.equal(await prisma.accountingEntry.count({ where: { organizationId: org.id } }), 0);
});

test("a draft whose destination became a truck cannot be validated (checked again at validation)", { skip: SKIP }, async () => {
  const org = await makeOrg("truckdraft");
  const draft = await notes.saveCreditNoteDraftAs(org.users.admin, customerInput(org));
  await prisma.creditNote.update({ where: { id: draft.id }, data: { stockDestinationLocationId: org.truckId } });
  await rejectsWith(notes.validateCreditNoteAs(org.users.admin, draft.id), 422, /camion refuse/);
  assert.equal((await prisma.creditNote.findUniqueOrThrow({ where: { id: draft.id } })).status, "DRAFT");
  assert.equal(await stockOf(org.productId, org.truckId), 0);
});

test("a stock location of another organisation is refused", { skip: SKIP }, async () => {
  const [org, other] = [await makeOrg("own"), await makeOrg("other")];
  await rejectsWith(
    notes.createManualCreditNoteAs(org.users.admin, customerInput(org, { stockDestinationLocationId: other.depotId })),
    422,
    /Destination de stock non autorisee/,
  );
  assert.equal(await stockOf(org.productId, other.depotId), 0);
});

// ---- settlement mode -----------------------------------------------------------------------------------------

test("« Avoir sur compte » credits the customer's account (no till line); the entry is balanced", { skip: SKIP }, async () => {
  const org = await makeOrg("account");
  const note = await notes.createManualCreditNoteAs(org.users.cashier, customerInput(org, { refundMode: "avoir_sur_compte" }));
  assert.equal(note.refundMode, "avoir_sur_compte");
  assert.equal((await prisma.creditNote.findUniqueOrThrow({ where: { id: note.id } })).refundMethod, "BANK");

  const [entry] = await entriesFor(org, note.id);
  assertBalanced(entry);
  assert.equal(entry.lines.some((line) => line.account.code === "51611"), false, "no cash leaves the till");
  const settings = await prisma.accountingSettings.findUniqueOrThrow({ where: { organizationId: org.id } });
  const customerLine = entry.lines.find((line) => line.accountId === settings.customerAccountId);
  assert.ok(customerLine, "the customer account is credited");
  assert.equal(customerLine.credit.toNumber(), note.totalTTC);
  assert.equal(await stockOf(org.productId, org.depotId), 3, "the stock rule is the same in both modes");
});

// ---- idempotency and double validation -----------------------------------------------------------------------

test("the same submission twice (sequential and concurrent) creates ONE note, one movement, one entry, stock credited once", { skip: SKIP }, async () => {
  const org = await makeOrg("idem");
  const input = customerInput(org);
  const first = await notes.createManualCreditNoteAs(org.users.cashier, input);
  const again = await notes.createManualCreditNoteAs(org.users.cashier, input);
  assert.equal(again.id, first.id);

  const concurrentInput = customerInput(org);
  const results = await Promise.all([
    notes.createManualCreditNoteAs(org.users.cashier, concurrentInput),
    notes.createManualCreditNoteAs(org.users.cashier, concurrentInput),
    notes.createManualCreditNoteAs(org.users.cashier, concurrentInput),
  ]);
  assert.equal(new Set(results.map((note) => note.id)).size, 1, "every concurrent call returns the same note");

  assert.equal(await prisma.creditNote.count({ where: { organizationId: org.id } }), 2);
  assert.equal(await prisma.stockMovement.count({ where: { organizationId: org.id } }), 2);
  assert.equal(await prisma.accountingEntry.count({ where: { organizationId: org.id } }), 2);
  assert.equal(await stockOf(org.productId, org.depotId), 6, "3 + 3, never 3 x 5");
});

test("a fresh note without its submission key is refused; updating a draft by id needs none", { skip: SKIP }, async () => {
  const org = await makeOrg("nokey");
  await rejectsWith(notes.createManualCreditNoteAs(org.users.cashier, customerInput(org, { idempotencyKey: null })), 422, /Identifiant de soumission/);
  await rejectsWith(notes.createManualCreditNoteAs(org.users.admin, supplierInput(org, { idempotencyKey: undefined })), 422, /Identifiant de soumission/);
  const draft = await notes.saveCreditNoteDraftAs(org.users.cashier, customerInput(org));
  const updated = await notes.saveCreditNoteDraftAs(org.users.cashier, customerInput(org, { id: draft.id, idempotencyKey: null, comment: "Commentaire complete" }));
  assert.equal(updated.id, draft.id);
  assert.equal(updated.comment, "Commentaire complete");
});

test("a draft is validated exactly once, even by concurrent calls; a validated note cannot be validated or edited again", { skip: SKIP }, async () => {
  const org = await makeOrg("double");
  const draft = await notes.saveCreditNoteDraftAs(org.users.cashier, customerInput(org));
  const outcomes = await Promise.allSettled([
    notes.validateCreditNoteAs(org.users.cashier, draft.id),
    notes.validateCreditNoteAs(org.users.admin, draft.id),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1, "one validation wins");
  const refused = outcomes.find((outcome) => outcome.status === "rejected") as PromiseRejectedResult;
  assert.equal((refused.reason as { status?: number }).status, 422);

  await rejectsWith(notes.validateCreditNoteAs(org.users.admin, draft.id), 422, /Seul un brouillon/);
  await rejectsWith(notes.createManualCreditNoteAs(org.users.admin, customerInput(org, { id: draft.id, idempotencyKey: null })), 422, /Seul un brouillon/);
  assert.equal(await stockOf(org.productId, org.depotId), 3, "credited once");
  assert.equal(await prisma.stockMovement.count({ where: { organizationId: org.id } }), 1);
  assert.equal(await prisma.accountingEntry.count({ where: { organizationId: org.id } }), 1);
});

// ---- reversal ---------------------------------------------------------------------------------------------------

test("reversal: admin / depot manager only; it takes the stock back and reverses the entry, once", { skip: SKIP }, async () => {
  const org = await makeOrg("reverse");
  const note = await notes.createManualCreditNoteAs(org.users.cashier, customerInput(org));
  await rejectsWith(notes.reverseCreditNoteAs(org.users.cashier, note.id), 403);

  const reversed = await notes.reverseCreditNoteAs(org.users.depot_manager, note.id);
  assert.equal(reversed.status, "CONTREPASSE");
  assert.equal(await stockOf(org.productId, org.depotId), 0, "the returned quantity leaves the depot again");
  const entries = await entriesFor(org, note.id);
  assert.equal(entries.length, 1, "the original entry");
  const reversal = await prisma.accountingEntry.findFirst({ where: { reversedEntryId: entries[0].id }, include: { lines: true } });
  assert.ok(reversal, "a reversal entry exists");
  assertBalanced(reversal);

  await rejectsWith(notes.reverseCreditNoteAs(org.users.admin, note.id), 422, /Seul un avoir valide/);
  assert.equal(await stockOf(org.productId, org.depotId), 0, "never reversed twice");
});

// ---- supplier notes: unchanged treatment ------------------------------------------------------------------------

test("supplier note: current treatment kept - depot stock decreases, SUPPLIER_RETURN, cash-mode entry 4411 / 6111 / 34552", { skip: SKIP }, async () => {
  const org = await makeOrg("supplier");
  await prisma.stockLevel.create({ data: { organizationId: org.id, productId: org.productId, locationId: org.depotId, quantity: 10, reservedQuantity: 0 } });

  const note = await notes.createManualCreditNoteAs(org.users.cashier, supplierInput(org));
  assert.equal(note.status, "VALIDE");
  assert.equal(note.refundMode, "remboursement_especes", "a supplier note keeps its cash treatment");
  assert.equal(await stockOf(org.productId, org.depotId), 8);
  const [movement] = await prisma.stockMovement.findMany({ where: { organizationId: org.id, referenceId: note.id } });
  assert.equal(movement.type, "SUPPLIER_RETURN");
  assert.equal(movement.sourceLocationId, org.depotId);

  const [entry] = await entriesFor(org, note.id);
  assertBalanced(entry);
  const codes = entry.lines.map((line) => line.account.code).sort();
  assert.deepEqual(codes, ["34552", "4411", "6111"]);
  assert.equal(entry.lines.find((line) => line.account.code === "4411")?.debit.toNumber(), note.totalTTC);

  // No justification is required from a supplier note (previous rule kept: only for « Autre »).
  assert.equal(note.comment, "");
});

test("supplier note: « Avoir sur compte » and a truck source are refused", { skip: SKIP }, async () => {
  const org = await makeOrg("supplierko");
  await prisma.stockLevel.create({ data: { organizationId: org.id, productId: org.productId, locationId: org.truckId, quantity: 10, reservedQuantity: 0 } });
  await rejectsWith(notes.createManualCreditNoteAs(org.users.admin, supplierInput(org, { refundMode: "avoir_sur_compte" })), 422, /uniquement les avoirs client/);
  await rejectsWith(notes.createManualCreditNoteAs(org.users.admin, supplierInput(org, { stockSourceLocationId: org.truckId })), 422, /camion refuse/);
  assert.equal(await stockOf(org.productId, org.truckId), 10, "the truck stock is untouched");
  assert.equal(await prisma.creditNote.count({ where: { organizationId: org.id } }), 0);
});

// ---- price control when a CASHIER validates a customer draft (Lot 1, validation) ---------------------------------------

async function makeLinkedSale(org: Org) {
  // 5 x 80 HT, VAT 20 %, sold at the counter: its line price (80) is NOT the catalogue price (100).
  const sale = await prisma.sale.create({
    data: {
      organizationId: org.id,
      invoiceNumber: `INV-${uid()}`,
      origin: "COUNTER",
      status: "PAID",
      stockLocationId: org.depotId,
      customerId: org.customerId,
      subtotalHT: 400,
      taxAmount: 80,
      totalTTC: 480,
      paidAmount: 480,
      paymentMethod: "CASH",
      createdByUserId: org.users.admin.id,
      validatedAt: new Date(),
      soldAt: new Date(),
      lines: { create: [{ productId: org.productId, quantity: 5, unitPriceHT: 80, unitCostHT: 12.5, taxRate: 20, taxAmount: 80, totalHT: 400, totalTTC: 480 }] },
    },
    include: { lines: true },
  });
  return sale.lines[0].id;
}

/** A refused validation changes nothing: draft stays a draft, no stock, no movement, no entry. */
async function assertUntouchedDraft(org: Org, id: string) {
  assert.equal((await prisma.creditNote.findUniqueOrThrow({ where: { id } })).status, "DRAFT");
  assert.equal(await stockOf(org.productId, org.depotId), 0, "no stock moved");
  assert.equal(await prisma.stockMovement.count({ where: { organizationId: org.id, referenceId: id } }), 0, "no movement");
  assert.equal(await prisma.accountingEntry.count({ where: { organizationId: org.id, sourceId: id } }), 0, "no accounting entry");
}

const catalogueRefusal = /prix differents du catalogue \(Sidi Ali 2 L\)/;

test("a cashier cannot validate an admin draft priced below the catalogue (403); the admin can, at that price", { skip: SKIP }, async () => {
  const org = await makeOrg("pv-price");
  const draft = await notes.saveCreditNoteDraftAs(org.users.admin, customerInput(org, { lines: [{ productId: org.productId, quantityReturned: 3, unitPrice: 80 }] }));
  assert.equal(draft.lines[0].unitPrice, 80, "the admin's manual price was kept in the draft");

  await rejectsWith(notes.validateCreditNoteAs(org.users.cashier, draft.id), 403, catalogueRefusal);
  await assertUntouchedDraft(org, draft.id);
  assert.equal((await prisma.creditNoteLine.findFirstOrThrow({ where: { creditNoteId: draft.id } })).unitPriceHT.toNumber(), 80, "the draft was NOT repriced");

  const validated = await notes.validateCreditNoteAs(org.users.admin, draft.id);
  assert.equal(validated.status, "VALIDE");
  assert.equal(validated.totalTTC, 288, "3 x 80 HT x 1.20, at the admin's price");
  assert.equal(await stockOf(org.productId, org.depotId), 3);
});

test("a cashier cannot validate a draft with a different DISCOUNT or a different VAT; the admin can", { skip: SKIP }, async () => {
  const org = await makeOrg("pv-disc");
  const withDiscount = await notes.saveCreditNoteDraftAs(
    org.users.admin,
    customerInput(org, { lines: [{ productId: org.productId, quantityReturned: 1, unitPrice: 100, discountPercent: 10, taxRate: 20 }] }),
  );
  await rejectsWith(notes.validateCreditNoteAs(org.users.cashier, withDiscount.id), 403, catalogueRefusal);
  await assertUntouchedDraft(org, withDiscount.id);

  const withVat = await notes.saveCreditNoteDraftAs(
    org.users.admin,
    customerInput(org, { lines: [{ productId: org.productId, quantityReturned: 1, unitPrice: 100, discountPercent: 0, taxRate: 10 }] }),
  );
  await rejectsWith(notes.validateCreditNoteAs(org.users.cashier, withVat.id), 403, catalogueRefusal);
  await assertUntouchedDraft(org, withVat.id);

  assert.equal((await notes.validateCreditNoteAs(org.users.admin, withDiscount.id)).status, "VALIDE");
  assert.equal((await notes.validateCreditNoteAs(org.users.admin, withVat.id)).status, "VALIDE");
});

test("a draft written by a cashier (priced at the catalogue) is validated by a cashier", { skip: SKIP }, async () => {
  const org = await makeOrg("pv-own");
  const draft = await notes.saveCreditNoteDraftAs(org.users.cashier, customerInput(org, { lines: [{ productId: org.productId, quantityReturned: 2, unitPrice: 1, discountPercent: 50 }] }));
  const validated = await notes.validateCreditNoteAs(org.users.cashier, draft.id);
  assert.equal(validated.status, "VALIDE");
  assert.equal(validated.totalTTC, 240);
  assert.equal(await stockOf(org.productId, org.depotId), 2);
});

test("the catalogue moves between draft and validation: the cashier is refused and nothing is recalculated; a re-save reprices; the admin is never held by the catalogue", { skip: SKIP }, async () => {
  const org = await makeOrg("pv-move");
  const draft = await notes.saveCreditNoteDraftAs(org.users.cashier, customerInput(org));
  assert.equal(draft.lines[0].unitPrice, 100);
  await prisma.product.update({ where: { id: org.productId }, data: { salePrice: 110 } });

  await rejectsWith(notes.validateCreditNoteAs(org.users.cashier, draft.id), 403, /re-enregistrez-le/);
  await assertUntouchedDraft(org, draft.id);
  assert.equal((await prisma.creditNoteLine.findFirstOrThrow({ where: { creditNoteId: draft.id } })).unitPriceHT.toNumber(), 100, "still the price at which the draft was written");

  // the cashier re-saves the draft (an explicit act): the lock reprices it at the NEW catalogue price ...
  const resaved = await notes.saveCreditNoteDraftAs(org.users.cashier, customerInput(org, { id: draft.id, idempotencyKey: null }));
  assert.equal(resaved.lines[0].unitPrice, 110);
  // ... and the validation then goes through.
  const validated = await notes.validateCreditNoteAs(org.users.cashier, draft.id);
  assert.equal(validated.status, "VALIDE");
  assert.equal(validated.totalTTC, 396, "3 x 110 HT x 1.20");

  // an admin draft left at the old price is validated by an admin at its own price
  const other = await notes.saveCreditNoteDraftAs(org.users.admin, customerInput(org, { lines: [{ productId: org.productId, quantityReturned: 1, unitPrice: 100 }] }));
  assert.equal((await notes.validateCreditNoteAs(org.users.admin, other.id)).totalTTC, 120);
});

test("a draft linked to an invoice is exempt: the cashier validates it although its sale-line price differs from the catalogue", { skip: SKIP }, async () => {
  const org = await makeOrg("pv-linked");
  const saleLineId = await makeLinkedSale(org);
  const draft = await notes.saveCreditNoteDraftAs(
    org.users.admin,
    customerInput(org, { returnMode: "LINKED", lines: [{ productId: org.productId, quantityReturned: 2, saleLineId }] }),
  );
  assert.equal(draft.lines[0].unitPrice, 80, "priced from the sale line, not the catalogue (100)");
  const validated = await notes.validateCreditNoteAs(org.users.cashier, draft.id);
  assert.equal(validated.status, "VALIDE");
  assert.equal(validated.totalTTC, 192);
  assert.equal(await stockOf(org.productId, org.depotId), 2);
});

test("a supplier draft is exempt from the control: the cashier validates it at the price the admin set", { skip: SKIP }, async () => {
  const org = await makeOrg("pv-supplier");
  await prisma.stockLevel.create({ data: { organizationId: org.id, productId: org.productId, locationId: org.depotId, quantity: 10, reservedQuantity: 0 } });
  const draft = await notes.saveCreditNoteDraftAs(org.users.admin, supplierInput(org, { lines: [{ productId: org.productId, quantityReturned: 2, unitPrice: 9, discountPercent: 5, taxRate: 7 }] }));
  const validated = await notes.validateCreditNoteAs(org.users.cashier, draft.id);
  assert.equal(validated.status, "VALIDE");
  assert.equal(validated.lines[0].unitPrice, 9, "no supplier price lock, as before");
  assert.equal(await stockOf(org.productId, org.depotId), 8);
});

// ---- /manual with an EXISTING draft id: status guard, kept controls, idempotence, full rollback (Lot 1) ---------------------
// Draft ownership and type: any desk role may edit any draft of its organisation, and the type of a draft (customer / supplier)
// follows the request - unchanged behaviour, deliberately not asserted here.

async function snapshot(id: string) {
  const n = await prisma.creditNote.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { createdAt: "asc" } } } });
  return JSON.stringify({
    status: n.status, comment: n.comment, customerId: n.customerId, supplierId: n.supplierId,
    dest: n.stockDestinationLocationId, src: n.stockSourceLocationId, total: n.totalTTC.toString(),
    refund: n.refundMethod, origin: n.origin, reason: n.reason, validatedAt: n.validatedAt, reversedAt: n.reversedAt,
    lines: n.lines.map((l) => [l.id, l.productId, l.quantity, l.unitPriceHT.toString(), l.discountRate.toString(), l.taxRate.toString(), l.totalTTC.toString()]),
  });
}
const effects = async (org: Org, id: string) => ({
  movements: await prisma.stockMovement.count({ where: { organizationId: org.id, referenceId: id } }),
  entries: await prisma.accountingEntry.count({ where: { organizationId: org.id, sourceId: id } }),
  audits: await prisma.auditLog.count({ where: { organizationId: org.id, entityId: id } }),
});
const edit = (org: Org, id: string, over: Partial<CreateCreditNoteInput> = {}) => customerInput(org, { id, idempotencyKey: null, ...over });

test("a VALIDATED or REVERSED note cannot be modified through /manual (any desk role): 422, nothing changes", { skip: SKIP }, async () => {
  const org = await makeOrg("p1");
  const note = await notes.createManualCreditNoteAs(org.users.admin, customerInput(org));
  const before = await snapshot(note.id);
  const fx = await effects(org, note.id);
  for (const role of ["cashier", "admin"] as const) {
    await rejectsWith(notes.createManualCreditNoteAs(org.users[role], edit(org, note.id, { comment: "tentative de modification", lines: [{ productId: org.productId, quantityReturned: 9 }] })), 422, /Seul un brouillon/);
    await rejectsWith(notes.saveCreditNoteDraftAs(org.users[role], edit(org, note.id, { comment: "tentative de retour en brouillon" })), 422, /Seul un brouillon/);
  }
  assert.equal(await snapshot(note.id), before, "the validated note is byte-identical");
  assert.deepEqual(await effects(org, note.id), fx);
  assert.equal(await stockOf(org.productId, org.depotId), 3);

  await notes.reverseCreditNoteAs(org.users.admin, note.id);
  const reversedBefore = await snapshot(note.id);
  await rejectsWith(notes.createManualCreditNoteAs(org.users.cashier, edit(org, note.id)), 422, /Seul un brouillon/);
  await rejectsWith(notes.saveCreditNoteDraftAs(org.users.cashier, edit(org, note.id)), 422, /Seul un brouillon/);
  assert.equal(await snapshot(note.id), reversedBefore, "the reversed note is untouched");
  assert.equal(await stockOf(org.productId, org.depotId), 0, "no stock re-applied");
});

test("editing a draft keeps every control: role, organisation, depot, justification, catalogue price - and a refused edit leaves the draft byte-identical", { skip: SKIP }, async () => {
  const [org, other] = [await makeOrg("p2"), await makeOrg("p2other")];
  const draft = await notes.saveCreditNoteDraftAs(org.users.admin, customerInput(org, { lines: [{ productId: org.productId, quantityReturned: 3, unitPrice: 80 }] }));
  const before = await snapshot(draft.id);

  const refused: Array<[string, () => Promise<unknown>, number, RegExp?]> = [
    ["driver, /manual", () => notes.createManualCreditNoteAs(org.users.driver, edit(org, draft.id)), 403],
    ["driver, draft save", () => notes.saveCreditNoteDraftAs(org.users.driver, edit(org, draft.id)), 403],
    ["other organisation's admin", () => notes.createManualCreditNoteAs(other.users.admin, edit(other, draft.id)), 404, /Brouillon introuvable/],
    ["other organisation's cashier (draft save)", () => notes.saveCreditNoteDraftAs(other.users.cashier, edit(other, draft.id)), 404, /Brouillon introuvable/],
    ["truck destination", () => notes.createManualCreditNoteAs(org.users.admin, edit(org, draft.id, { stockDestinationLocationId: org.truckId })), 422, /camion refuse/],
    ["other organisation's depot", () => notes.createManualCreditNoteAs(org.users.cashier, edit(org, draft.id, { stockDestinationLocationId: other.depotId })), 422, /Destination de stock non autorisee/],
    ["other organisation's customer", () => notes.createManualCreditNoteAs(org.users.cashier, edit(org, draft.id, { customerId: other.customerId })), 422, /Client introuvable/],
    ["other organisation's product", () => notes.createManualCreditNoteAs(org.users.cashier, edit(org, draft.id, { lines: [{ productId: other.productId, quantityReturned: 1 }] })), 422, /introuvable ou inactif/],
    ["short justification (cashier)", () => notes.createManualCreditNoteAs(org.users.cashier, edit(org, draft.id, { comment: "ok" })), 422, /justification/],
    ["short justification (admin, draft save)", () => notes.saveCreditNoteDraftAs(org.users.admin, edit(org, draft.id, { comment: "" })), 422, /justification/],
    ["account mode on a supplier-shaped edit", () => notes.createManualCreditNoteAs(org.users.admin, supplierInput(org, { id: draft.id, idempotencyKey: null, refundMode: "avoir_sur_compte" })), 422, /uniquement les avoirs client/],
  ];
  for (const [label, run, status, message] of refused) {
    await rejectsWith(run(), status, message);
    assert.equal(await snapshot(draft.id), before, `${label}: the draft is byte-identical after the refusal`);
  }
  assert.equal(await stockOf(org.productId, org.truckId), 0);
  assert.equal(await stockOf(org.productId, org.depotId), 0);
  assert.deepEqual(await effects(org, draft.id), { movements: 0, entries: 0, audits: 1 }, "only the creation audit; no movement, no entry");

  // price control on edit: the cashier's edit of an admin draft is repriced to the catalogue; the admin keeps his price
  const cashierEdit = await notes.saveCreditNoteDraftAs(org.users.cashier, edit(org, draft.id, { lines: [{ productId: org.productId, quantityReturned: 3, unitPrice: 1, discountPercent: 90, taxRate: 0 }] }));
  assert.equal(cashierEdit.lines[0].unitPrice, 100);
  assert.equal(cashierEdit.lines[0].discountPercent, 0);
  assert.equal(cashierEdit.lines[0].taxRate, 20);
  const adminEdit = await notes.saveCreditNoteDraftAs(org.users.admin, edit(org, draft.id, { lines: [{ productId: org.productId, quantityReturned: 3, unitPrice: 70 }] }));
  assert.equal(adminEdit.lines[0].unitPrice, 70);

  // validating THROUGH /manual with the id: the cashier's lines are priced at the catalogue whatever is sent
  const viaManual = await notes.createManualCreditNoteAs(org.users.cashier, edit(org, draft.id, { lines: [{ productId: org.productId, quantityReturned: 3, unitPrice: 5 }] }));
  assert.equal(viaManual.status, "VALIDE");
  assert.equal(viaManual.totalTTC, 360);
  assert.equal(viaManual.id, draft.id, "the SAME note is validated - no second note is created");
  assert.equal(await prisma.creditNote.count({ where: { organizationId: org.id } }), 1);
});


test("repeating the request creates no second movement and no second entry (sequential, concurrent, and repeated draft saves)", { skip: SKIP }, async () => {
  const org = await makeOrg("p3");
  // repeated draft saves by id: lines replaced, never duplicated, no side effect
  const draft = await notes.saveCreditNoteDraftAs(org.users.cashier, customerInput(org));
  for (let i = 0; i < 3; i += 1) await notes.saveCreditNoteDraftAs(org.users.cashier, edit(org, draft.id));
  assert.equal(await prisma.creditNoteLine.count({ where: { creditNoteId: draft.id } }), 1, "one line, not four");
  assert.deepEqual(await effects(org, draft.id), { movements: 0, entries: 0, audits: 4 });

  // validate through /manual with the id, then repeat it
  const request = () => notes.createManualCreditNoteAs(org.users.cashier, edit(org, draft.id));
  assert.equal((await request()).status, "VALIDE");
  await rejectsWith(request(), 422, /Seul un brouillon/);
  await rejectsWith(request(), 422, /Seul un brouillon/);
  const after = await effects(org, draft.id);
  assert.equal(after.movements, 1);
  assert.equal(after.entries, 1);
  assert.equal(await stockOf(org.productId, org.depotId), 3);

  // concurrent repetition on a fresh draft
  const second = await notes.saveCreditNoteDraftAs(org.users.admin, customerInput(org));
  const outcomes = await Promise.allSettled([1, 2, 3, 4].map(() => notes.createManualCreditNoteAs(org.users.admin, edit(org, second.id))));
  assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1, "exactly one request validates");
  for (const o of outcomes.filter((x): x is PromiseRejectedResult => x.status === "rejected")) assert.equal((o.reason as { status?: number }).status, 422);
  const concurrent = await effects(org, second.id);
  assert.equal(concurrent.movements, 1);
  assert.equal(concurrent.entries, 1);
  assert.equal(await stockOf(org.productId, org.depotId), 6, "3 + 3, never more");
});

test("an error in the middle of the edit (after the note and its lines were rewritten) rolls everything back - the draft is not partly modified", { skip: SKIP }, async () => {
  const org = await makeOrg("p4");
  // A supplier draft of 2 units; the depot holds only 1: the stock check throws INSIDE the transaction,
  // after the note update and the replacement of its lines.
  await prisma.stockLevel.create({ data: { organizationId: org.id, productId: org.productId, locationId: org.depotId, quantity: 1, reservedQuantity: 0 } });
  const draft = await notes.saveCreditNoteDraftAs(org.users.admin, supplierInput(org, { comment: "brouillon d'origine" }));
  const before = await snapshot(draft.id);
  const fx = await effects(org, draft.id);

  await rejectsWith(
    notes.createManualCreditNoteAs(org.users.admin, supplierInput(org, { id: draft.id, idempotencyKey: null, comment: "modification a annuler", lines: [{ productId: org.productId, quantityReturned: 5, unitPrice: 11, discountPercent: 0, taxRate: 20 }] })),
    422,
    /Stock insuffisant/,
  );
  assert.equal(await snapshot(draft.id), before, "status, comment, quantity, prices and even the line ids are exactly as before");
  assert.deepEqual(await effects(org, draft.id), fx, "no movement, no entry, no extra audit");
  assert.equal(await stockOf(org.productId, org.depotId), 1, "stock untouched");

  // same guarantee on a customer draft: a linked line over its cap fails inside the edit
  const sale = await prisma.sale.create({
    data: {
      organizationId: org.id, invoiceNumber: `INV-${uid()}`, origin: "COUNTER", status: "PAID", stockLocationId: org.depotId, customerId: org.customerId,
      subtotalHT: 400, taxAmount: 80, totalTTC: 480, paidAmount: 480, paymentMethod: "CASH", createdByUserId: org.users.admin.id, validatedAt: new Date(), soldAt: new Date(),
      lines: { create: [{ productId: org.productId, quantity: 5, unitPriceHT: 80, unitCostHT: 12.5, taxRate: 20, taxAmount: 80, totalHT: 400, totalTTC: 480 }] },
    },
    include: { lines: true },
  });
  const customerDraft = await notes.saveCreditNoteDraftAs(org.users.admin, customerInput(org, { comment: "brouillon client d'origine" }));
  const customerBefore = await snapshot(customerDraft.id);
  await rejectsWith(
    notes.createManualCreditNoteAs(org.users.cashier, edit(org, customerDraft.id, { returnMode: "LINKED", lines: [{ productId: org.productId, quantityReturned: 9, saleLineId: sale.lines[0].id }] })),
    422,
    /Quantite retournable depassee/,
  );
  assert.equal(await snapshot(customerDraft.id), customerBefore, "customer draft untouched after the refused edit");
  assert.equal(await stockOf(org.productId, org.depotId), 1);
});
