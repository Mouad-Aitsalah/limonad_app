import "dotenv/config";

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/lib/generated/prisma/client";
import { assertDevDatabaseOnly, assertLoopbackServer } from "@/lib/db-test-guard";
import { findConfigurableTable, visibleTableColumns } from "@/lib/table-columns/columns";
import {
  readUserTablePreferences,
  resetUserTablePreference,
  saveUserTablePreference,
} from "@/lib/table-columns/preferences-core";

/**
 * Real-SQL tests of the per-user column preferences: persistence (read back
 * by a fresh query, as after a reload or a new login), isolation between
 * users and between organisations, reset. ONE transaction, ALWAYS rolled
 * back. Skipped when the database is unreachable.
 */

// Never against production or a hosted database (lib/db-test-guard.ts): throws before any connection is made.
assertDevDatabaseOnly("lib/table-columns/preferences.db.test.ts");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
let reachable = false;

before(async () => {
  await assertLoopbackServer(prisma, "lib/table-columns/preferences.db.test.ts");
  try {
    await Promise.race([
      prisma.$queryRaw`select 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 20_000)),
    ]);
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

async function inRolledBackTransaction(work: (tx: Tx) => Promise<void>) {
  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        await work(tx);
        throw new Rollback("rollback");
      },
      { timeout: 120_000, maxWait: 30_000 },
    ),
    (error: unknown) => error instanceof Rollback,
  );
}

let counter = 0;
const uid = () => `${Date.now().toString(36)}${(counter += 1)}`;

async function admin(tx: Tx, organizationId: string, label: string) {
  const suffix = uid();
  return tx.user.create({
    data: {
      organizationId,
      firstName: "T",
      lastName: label,
      fullName: `T ${label}`,
      email: `t-cols-${label}-${suffix}@example.invalid`,
      passwordHash: "x",
      role: "ADMIN",
    },
  });
}

test("preferences persist, belong to ONE user in ONE organisation, and reset to the default", async (t) => {
  if (!reachable) return t.skip("database unreachable");
  await inRolledBackTransaction(async (tx) => {
    const suffix = uid();
    const orgA = await tx.organization.create({ data: { code: `T-COLA-${suffix}`, name: "Org A" } });
    const orgB = await tx.organization.create({ data: { code: `T-COLB-${suffix}`, name: "Org B" } });
    const a1 = await admin(tx, orgA.id, "a1");
    const a2 = await admin(tx, orgA.id, "a2");
    const b1 = await admin(tx, orgB.id, "b1");
    const scopeA1 = { userId: a1.id, organizationId: orgA.id };

    const saved = await saveUserTablePreference(tx, scopeA1, {
      table: "stock.warehouseStock",
      order: ["product", "value", "category", "currentStock", "minimumStock", "status"],
      hidden: ["category", "product"], // product is required: never hidden
    });
    assert.deepEqual(saved, {
      ok: true,
      table: "stock.warehouseStock",
      preference: { order: ["product", "value", "category", "currentStock", "minimumStock", "status"], hidden: ["category"] },
    });

    // read back by a fresh query (= after a reload / a new login)
    const again = await readUserTablePreferences(tx, scopeA1);
    assert.deepEqual(visibleTableColumns(findConfigurableTable("stock.warehouseStock")!, again["stock.warehouseStock"]), [
      "product", "value", "currentStock", "minimumStock", "status",
    ]);

    // the other admin of the same organisation, an admin of another organisation,
    // and the same user id scoped to another organisation see nothing
    assert.deepEqual(await readUserTablePreferences(tx, { userId: a2.id, organizationId: orgA.id }), {});
    assert.deepEqual(await readUserTablePreferences(tx, { userId: b1.id, organizationId: orgB.id }), {});
    assert.deepEqual(await readUserTablePreferences(tx, { userId: a1.id, organizationId: orgB.id }), {});

    // another user's save never changes a1's row
    await saveUserTablePreference(tx, { userId: a2.id, organizationId: orgA.id }, { table: "stock.warehouseStock", order: [], hidden: ["value"] });
    assert.deepEqual((await readUserTablePreferences(tx, scopeA1))["stock.warehouseStock"].hidden, ["category"]);

    // saving again updates the same row (one row per user / organisation / table)
    await saveUserTablePreference(tx, scopeA1, { table: "stock.warehouseStock", order: [], hidden: ["status"] });
    assert.equal(await tx.userTablePreference.count({ where: { userId: a1.id, organizationId: orgA.id } }), 1);
    // the hidden column can be shown again
    await saveUserTablePreference(tx, scopeA1, { table: "stock.warehouseStock", order: [], hidden: [] });
    assert.deepEqual(await readUserTablePreferences(tx, scopeA1), {}, "a default choice removes the row");

    // reset ("Restaurer par défaut") only removes the caller's own row
    await saveUserTablePreference(tx, scopeA1, { table: "accounts.accounts", order: [], hidden: ["phone"] });
    assert.deepEqual(await resetUserTablePreference(tx, scopeA1, "accounts.accounts"), { ok: true, table: "accounts.accounts" });
    assert.deepEqual(await readUserTablePreferences(tx, scopeA1), {});
    assert.deepEqual(
      Object.keys(await readUserTablePreferences(tx, { userId: a2.id, organizationId: orgA.id })),
      ["stock.warehouseStock"],
      "a2 untouched",
    );

    // unknown tables are refused
    assert.equal((await saveUserTablePreference(tx, scopeA1, { table: "products.products", order: [], hidden: [] })).ok, false);
    assert.equal((await resetUserTablePreference(tx, scopeA1, "nope")).ok, false);

    // a stale / hand-edited row falls back to the default columns
    await tx.userTablePreference.create({
      data: { userId: a1.id, organizationId: orgA.id, tableKey: "salesArchive.invoices", settings: { order: "broken", hidden: [42, "order"] } },
    });
    const stale = await readUserTablePreferences(tx, scopeA1);
    assert.deepEqual(
      visibleTableColumns(findConfigurableTable("salesArchive.invoices")!, stale["salesArchive.invoices"]),
      ["order", "date", "customer", "driverUser", "items", "total", "net", "payment", "status", "actions"],
    );
  });
});
