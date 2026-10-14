import "dotenv/config";

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/lib/generated/prisma/client";
import { assertDevDatabaseOnly, assertLoopbackServer } from "@/lib/db-test-guard";
import {
  decideApiModuleAccess,
  readOrganizationDisabledModules,
  writeOrganizationModuleSettings,
} from "@/lib/modules/module-access-core";

/**
 * Real-SQL tests of the organisation modules (SUPER_ADMIN choice, isolation,
 * audit, data kept, server-side refusal). Everything is written inside ONE
 * transaction that is ALWAYS rolled back: no row ever stays in the database.
 * Skipped when the database is unreachable.
 */

// Never against production or a hosted database (lib/db-test-guard.ts): throws before any connection is made.
assertDevDatabaseOnly("lib/modules/module-access.db.test.ts");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
let reachable = false;

before(async () => {
  await assertLoopbackServer(prisma, "lib/modules/module-access.db.test.ts");
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

async function setup(tx: Tx) {
  const suffix = uid();
  const superAdmin = await tx.user.create({
    data: {
      firstName: "Super",
      lastName: "Admin",
      fullName: "Super Admin",
      email: `t-super-${suffix}@example.invalid`,
      passwordHash: "x",
      role: "SUPER_ADMIN",
    },
  });
  const orgA = await tx.organization.create({ data: { code: `T-MODA-${suffix}`, name: "Org A" } });
  const orgB = await tx.organization.create({ data: { code: `T-MODB-${suffix}`, name: "Org B" } });
  const category = await tx.category.create({ data: { organizationId: orgA.id, name: "Cat" } });
  const product = await tx.product.create({
    data: {
      organizationId: orgA.id,
      categoryId: category.id,
      reference: `P-${suffix}`,
      name: "Produit test",
      salePrice: 10,
      purchasePrice: 5,
      taxRate: 20,
      unit: "U",
    },
  });
  return { superAdmin, orgA, orgB, product };
}

test("existing and new organisations: every module enabled (NULL settings)", async (t) => {
  if (!reachable) return t.skip("database unreachable");
  await inRolledBackTransaction(async (tx) => {
    const { orgA } = await setup(tx);
    const fresh = await tx.organization.findUniqueOrThrow({ where: { id: orgA.id }, select: { moduleSettings: true } });
    assert.equal(fresh.moduleSettings, null);
    assert.deepEqual(await readOrganizationDisabledModules(tx, orgA.id), []);
  });
});

test("SUPER_ADMIN: disabling modules for one organisation never touches another; audited; data kept; re-enable works", async (t) => {
  if (!reachable) return t.skip("database unreachable");
  await inRolledBackTransaction(async (tx) => {
    const { superAdmin, orgA, orgB, product } = await setup(tx);
    const productsBefore = await tx.product.count({ where: { organizationId: orgA.id } });

    const result = await writeOrganizationModuleSettings(tx, {
      organizationId: orgA.id,
      actorUserId: superAdmin.id,
      input: { modules: { stock: false, gps: false, pos: true } },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(await readOrganizationDisabledModules(tx, orgA.id), ["stock", "gps"]);
    assert.deepEqual(await readOrganizationDisabledModules(tx, orgB.id), [], "organisation B unchanged");
    const orgBRow = await tx.organization.findUniqueOrThrow({ where: { id: orgB.id }, select: { moduleSettings: true } });
    assert.equal(orgBRow.moduleSettings, null);

    // audited, on organisation A only
    const audit = await tx.auditLog.findMany({ where: { action: "ORGANIZATION_MODULES_UPDATED", entityId: { in: [orgA.id, orgB.id] } } });
    assert.equal(audit.length, 1);
    assert.equal(audit[0].organizationId, orgA.id);
    assert.equal(audit[0].userId, superAdmin.id);
    assert.deepEqual(audit[0].oldValue, { disabledModules: [] });
    assert.deepEqual(audit[0].newValue, { disabledModules: ["stock", "gps"] });

    // disabling never deletes data
    assert.equal(await tx.product.count({ where: { organizationId: orgA.id } }), productsBefore);
    assert.ok(await tx.product.findUnique({ where: { id: product.id } }));

    // server-side refusal for A, unchanged access for B
    const disabledA = await readOrganizationDisabledModules(tx, orgA.id);
    const disabledB = await readOrganizationDisabledModules(tx, orgB.id);
    for (const [pathname, method] of [["/api/stock", "GET"], ["/api/stock/adjustments", "POST"], ["/api/trucks/live", "GET"], ["/api/driver/tour/location/batch", "POST"]]) {
      assert.equal(decideApiModuleAccess({ pathname, method, organizationId: orgA.id, disabledModules: disabledA }).allowed, false, `A ${pathname}`);
      assert.equal(decideApiModuleAccess({ pathname, method, organizationId: orgB.id, disabledModules: disabledB }).allowed, true, `B ${pathname}`);
    }
    // still-enabled modules keep working for A (incl. a route shared with the POS)
    for (const [pathname, method] of [["/api/sales/context", "GET"], ["/api/stock/locations", "GET"], ["/api/products/search", "GET"]]) {
      assert.equal(decideApiModuleAccess({ pathname, method, organizationId: orgA.id, disabledModules: disabledA }).allowed, true, pathname);
    }

    // re-enable everything: the full choice replaces the previous one
    const reenabled = await writeOrganizationModuleSettings(tx, {
      organizationId: orgA.id,
      actorUserId: superAdmin.id,
      input: { modules: { stock: true, gps: true } },
    });
    assert.equal(reenabled.ok, true);
    assert.deepEqual(await readOrganizationDisabledModules(tx, orgA.id), []);
  });
});

test("invalid or forged configurations are refused and change nothing", async (t) => {
  if (!reachable) return t.skip("database unreachable");
  await inRolledBackTransaction(async (tx) => {
    const { superAdmin, orgA } = await setup(tx);
    await writeOrganizationModuleSettings(tx, { organizationId: orgA.id, actorUserId: superAdmin.id, input: { modules: { gps: false } } });
    for (const input of [
      { modules: { products: false } },
      { modules: { settings: false } },
      { modules: { notAModule: false } },
      { modules: { stock: "false" } },
      { modules: null },
      "disable everything",
    ]) {
      const result = await writeOrganizationModuleSettings(tx, { organizationId: orgA.id, actorUserId: superAdmin.id, input });
      assert.deepEqual(result.ok, false, JSON.stringify(input));
      if (!result.ok) assert.equal(result.status, 422);
    }
    assert.deepEqual(await readOrganizationDisabledModules(tx, orgA.id), ["gps"], "previous choice kept");
    const unknown = await writeOrganizationModuleSettings(tx, { organizationId: "does-not-exist", actorUserId: superAdmin.id, input: { modules: {} } });
    assert.deepEqual(unknown, { ok: false, status: 404, message: "Organisation introuvable." });

    // an old / hand-edited value never locks the organisation: unknown keys ignored, essential kept on
    await tx.organization.update({
      where: { id: orgA.id },
      data: { moduleSettings: { modules: { products: false, legacyModule: false, stock: "no", dashboard: false }, extra: 1 } },
    });
    assert.deepEqual(await readOrganizationDisabledModules(tx, orgA.id), ["dashboard"]);
  });
});
