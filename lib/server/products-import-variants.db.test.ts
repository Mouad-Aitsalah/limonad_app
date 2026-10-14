import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/lib/generated/prisma/client";
import { assertDevDatabaseOnly, assertLoopbackServer } from "@/lib/db-test-guard";
import { parseProductGrid } from "@/lib/import-export/products-format";
import { productImportRowSchema, type ProductImportRow } from "@/lib/products-import-rules";
import { classifyProductImportRowsWith } from "@/lib/server/products-import-core";

/**
 * The grouped preview against the development database - READ ONLY: the only
 * statements are SELECTs (the classification preloads, nothing writes), and the
 * test checks the product count did not move. It uses no variant column (they may
 * not exist in this database yet): the products are matched by reference.
 * Skipped when the database is unreachable or empty.
 */

// Never against production or a hosted database (lib/db-test-guard.ts): throws before any connection is made.
assertDevDatabaseOnly("lib/server/products-import-variants.db.test.ts");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
let ctx: {
  organizationId: string;
  locationId: string;
  supplierCode: string;
  product: { reference: string; name: string; categoryName: string };
  productCount: number;
  counts: () => Promise<number[]>;
} | null = null;

before(async () => {
  await assertLoopbackServer(prisma, "lib/server/products-import-variants.db.test.ts");
  try {
    const product = await prisma.product.findFirst({
      where: { category: { name: { not: "" } } },
      select: { organizationId: true, reference: true, name: true, category: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    });
    if (!product) return;
    const [location, supplier, productCount] = await Promise.all([
      prisma.stockLocation.findFirst({ where: { organizationId: product.organizationId, type: "DEPOT" }, select: { id: true } }),
      prisma.supplier.findFirst({ where: { organizationId: product.organizationId, active: true }, select: { code: true } }),
      prisma.product.count({ where: { organizationId: product.organizationId } }),
    ]);
    if (!location || !supplier) return;
    ctx = {
      organizationId: product.organizationId,
      locationId: location.id,
      supplierCode: supplier.code,
      product: { reference: product.reference, name: product.name, categoryName: product.category.name },
      productCount,
      // everything an import could write: none of these counts may move
      counts: () =>
        Promise.all([
          prisma.product.count(),
          prisma.supplier.count(),
          prisma.category.count(),
          prisma.brand.count(),
          prisma.stockLevel.count(),
          prisma.stockMovement.count(),
          prisma.auditLog.count(),
        ]),
    };
  } catch {
    ctx = null;
  }
});

after(async () => {
  await prisma.$disconnect();
});

function sentRows(grid: unknown[][]): ProductImportRow[] {
  const parsed = parseProductGrid(grid);
  assert.equal(parsed.fatal, undefined);
  return parsed.lines.filter((entry) => !entry.errors.length).map((entry) => productImportRowSchema.parse(entry.line));
}

test("db: a valid variants group is NEW and grouped; a conflicting variant blocks the whole group; nothing is written", { skip: false }, async (t) => {
  if (!ctx) return t.skip("database unreachable or empty");
  const countsBefore = await ctx.counts();
  const parent = `ZZ-TEST-VARIANTES-${randomUUID().slice(0, 8)}`;
  const category = ctx.product.categoryName;
  const defaults = { supplierCode: ctx.supplierCode, taxRate: 20 };
  const options = { applyStock: false, creationDefaults: defaults };

  // ---- a clean group
  const clean = sentRows([
    [parent, "", category, 100, 150, 5, "TAILLE: S | COULEUR: NOIR"],
    [parent, "", category, 100, 150, 5, "TAILLE: M | COULEUR: NOIR"],
  ]);
  const ok = await classifyProductImportRowsWith(prisma, ctx.organizationId, ctx.locationId, clean, options);
  assert.deepEqual(ok.rows.map((row) => row.status), ["NEW", "NEW"]);
  assert.equal(ok.groups.length, 1);
  assert.equal(ok.groups[0].blocked, false);
  assert.equal(ok.rows[0].supplierCreate, false, "the supplier of the page exists in this organisation");
  assert.equal(ok.rows[0].appliedTaxRate, 20);

  // ---- the same group, one variant carrying the barcode that is the REFERENCE of a different stored product
  const conflicting = sentRows([
    [parent, "", category, 100, 150, 5, "TAILLE: S | COULEUR: NOIR"],
    [parent, ctx.product.reference, category, 100, 150, 5, "TAILLE: M | COULEUR: NOIR"],
    [parent, "", category, 100, 150, 5, "TAILLE: L | COULEUR: NOIR"],
  ]);
  const blocked = await classifyProductImportRowsWith(prisma, ctx.organizationId, ctx.locationId, conflicting, options);
  assert.deepEqual(blocked.rows.map((row) => row.status), ["ERROR", "CONFLICT", "ERROR"]);
  assert.match(blocked.rows[1].message, /déjà utilisée par un autre produit/);
  assert.deepEqual(blocked.rows.map((row) => row.wouldBe), ["NEW", undefined, "NEW"]);
  assert.equal(blocked.groups[0].blocked, true);
  assert.equal(blocked.summary.blocked, 2);
  assert.equal(blocked.summary.new, 0, "not one line of the blocked group is importable");

  // ---- without the page's supplier / VAT: refused with a message that says what to do
  const unconfirmed = await classifyProductImportRowsWith(prisma, ctx.organizationId, ctx.locationId, clean, { applyStock: false });
  assert.ok(unconfirmed.rows.every((row) => row.status === "ERROR" && row.groupBlocked));
  assert.match(unconfirmed.rows[0].message, /TVA \(à confirmer sur la page\)/);

  // ---- read only: no product, supplier, category, brand, stock level, movement or audit entry was created
  assert.deepEqual(await ctx.counts(), countsBefore);
  const after = await prisma.product.count({ where: { organizationId: ctx.organizationId } });
  assert.equal(after, ctx.productCount);
  assert.equal(await prisma.product.count({ where: { organizationId: ctx.organizationId, reference: { startsWith: "ZZ-TEST-VARIANTES" } } }), 0);
});
