import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/lib/generated/prisma/client";
import { addDays } from "@/lib/forecasting/daily-sales-series";
import type { ForecastDb } from "@/lib/forecasting/product-daily-sales";
import {
  buildPurchaseRecommendationsLive,
  type PurchaseRecommendation,
  type PurchaseRecommendationResult,
} from "@/lib/forecasting/purchase-recommendation";

import {
  PURCHASE_TOOL_INSTRUCTIONS,
  PURCHASE_TOOL_NAME,
  createPurchaseToolRunner,
  purchaseRecommendationsArgumentsSchema,
  purchaseRecommendationsDeclaration,
} from "./assistant-purchase-tool";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function item(overrides: Partial<PurchaseRecommendation> = {}): PurchaseRecommendation {
  return {
    productId: "p1",
    productName: "Coca 2L",
    productStatus: "ACTIVE",
    currentStock: 12,
    stockKnown: true,
    stockRegularizationRequired: false,
    forecast1Day: 6,
    forecast3Days: 17,
    forecast7Days: 40,
    safetyStock: 22,
    safetyStockRule: "demand_variability",
    targetStock: 62,
    recommendedPurchaseQuantity: 50,
    model: "moving_average",
    mae: 0.4,
    reliability: "sufficient",
    historyDays: 120,
    soldDays: 60,
    reason: "Le stock actuel (12) est inférieur au stock cible (62).",
    ...overrides,
  };
}

function engine(recommendations: PurchaseRecommendation[], calls: unknown[] = []) {
  return {
    calls,
    getPurchaseRecommendations: async (options?: unknown): Promise<PurchaseRecommendationResult> => {
      calls.push(options);
      return { asOf: "2026-09-13", recommendations, source: "live" as const };
    },
  };
}

const DATASET = [
  item(),
  item({ productId: "p2", productName: "Eau 1L", currentStock: 8, forecast7Days: 25, safetyStock: 13, targetStock: 38, recommendedPurchaseQuantity: 30, reliability: "limited" }),
  item({ productId: "p3", productName: "Coca 1L", currentStock: -12, stockRegularizationRequired: true, forecast7Days: 10, safetyStock: 4, targetStock: 14, recommendedPurchaseQuantity: 0, reason: "Stock négatif (-12) : aucun achat automatique n'est recommandé, le stock doit d'abord être régularisé." }),
  item({ productId: "p4", productName: "Jus Orange", currentStock: 300, recommendedPurchaseQuantity: 0, reason: "Le stock actuel (300) couvre le stock cible (62) : aucun achat nécessaire." }),
  item({ productId: "p5", productName: "Jamais vendu", reliability: "none", historyDays: 0, soldDays: 0, forecast7Days: 0, safetyStock: 0, targetStock: 0, recommendedPurchaseQuantity: 0 }),
];

test("1+7. the tool returns the engine's recommendations, quantities untouched", async () => {
  const run = createPurchaseToolRunner(engine(DATASET));
  const result = (await run({})) as { toBuy: Array<Record<string, unknown>>; asOf: string; horizonDays: number; toBuyCount: number };
  assert.equal(result.asOf, "2026-09-13");
  assert.equal(result.horizonDays, 7);
  assert.equal(result.toBuyCount, 2);
  const coca = result.toBuy.find((x) => x.productName === "Coca 2L")!;
  assert.equal(coca.recommendedPurchase, 50);
  assert.equal(coca.currentStock, 12);
  assert.equal(coca.forecast1Day, 6);
  assert.equal(coca.forecast3Days, 17);
  assert.equal(coca.forecast7Days, 40);
  assert.equal(coca.safetyStock, 22);
  assert.equal(coca.targetStock, 62);
  assert.equal(coca.reliability, "sufficient");
  assert.equal(coca.reliabilityLabel, "suffisante");
  assert.equal(coca.stockKnown, true);
  assert.equal(coca.productStatus, "ACTIVE");
  assert.match(String(coca.reason), /stock cible/);
  // sorted as the engine gave them (largest purchase first is the engine's own order)
  assert.deepEqual(result.toBuy.map((x) => x.productName), ["Coca 2L", "Eau 1L"]);
});

test("8. the tool never recomputes: inconsistent engine numbers come back exactly as given", async () => {
  const odd = item({ currentStock: 1, forecast7Days: 2, safetyStock: 3, targetStock: 999, recommendedPurchaseQuantity: 777 });
  const result = (await createPurchaseToolRunner(engine([odd]))({})) as { toBuy: Array<Record<string, unknown>> };
  assert.equal(result.toBuy[0].recommendedPurchase, 777);
  assert.equal(result.toBuy[0].targetStock, 999);
  // and the tool source contains no purchase arithmetic
  const source = read("./assistant-purchase-tool.ts");
  assert.equal(/targetStock\s*-|-\s*currentStock|Math\.max\(0/.test(source), false);
});

test("4. negative stock: listed apart, flagged, never an automatic purchase", async () => {
  const result = (await createPurchaseToolRunner(engine(DATASET))({})) as {
    toBuy: Array<Record<string, unknown>>;
    negativeStock: Array<Record<string, unknown>>;
    negativeStockCount: number;
  };
  assert.equal(result.negativeStockCount, 1);
  const negative = result.negativeStock[0];
  assert.equal(negative.productName, "Coca 1L");
  assert.equal(negative.currentStock, -12);
  assert.equal(negative.recommendedPurchase, 0);
  assert.equal(negative.stockAlert, "Stock négatif à régulariser");
  assert.equal(result.toBuy.some((x) => x.productName === "Coca 1L"), false);
  assert.match(String(negative.reason), /régularisé/);
});

test("lists: products without purchase only on request; never-sold products hidden; truncation is flagged", async () => {
  const run = createPurchaseToolRunner(engine(DATASET));
  const base = (await run({})) as Record<string, unknown>;
  assert.equal("noPurchaseNeeded" in base, false);
  assert.equal(base.noPurchaseNeededCount, 1, "Jus Orange only: never-sold and negative ones are counted elsewhere");
  const full = (await run({ includeNoPurchase: true })) as { noPurchaseNeeded: Array<Record<string, unknown>> };
  assert.deepEqual(full.noPurchaseNeeded.map((x) => x.productName), ["Jus Orange"]);
  const withNever = (await run({ includeNoPurchase: true, includeNeverSold: true })) as { noPurchaseNeeded: Array<Record<string, unknown>> };
  assert.deepEqual(withNever.noPurchaseNeeded.map((x) => x.productName).sort(), ["Jamais vendu", "Jus Orange"]);
  const truncated = (await run({ maxProducts: 1 })) as { toBuy: unknown[]; toBuyTruncated: boolean; toBuyCount: number };
  assert.equal(truncated.toBuy.length, 1);
  assert.equal(truncated.toBuyTruncated, true);
  assert.equal(truncated.toBuyCount, 2);
});

test("one product: found / multipleMatches / not found, accent- and case-insensitive", async () => {
  const run = createPurchaseToolRunner(engine(DATASET));
  const one = (await run({ productQuery: "coca 2l" })) as { found: boolean; multipleMatches: boolean; products: Array<Record<string, unknown>> };
  assert.equal(one.found, true);
  assert.equal(one.multipleMatches, false);
  assert.equal(one.products[0].recommendedPurchase, 50);
  const several = (await run({ productQuery: "COCA" })) as { multipleMatches: boolean; products: unknown[] };
  assert.equal(several.multipleMatches, true);
  assert.equal(several.products.length, 2);
  const none = (await run({ productQuery: "Fanta" })) as { found: boolean; products: unknown[] };
  assert.equal(none.found, false);
  assert.deepEqual(none.products, []);
  const accent = createPurchaseToolRunner(engine([item({ productName: "Café Noir" })]));
  assert.equal(((await accent({ productQuery: "cafe" })) as { found: boolean }).found, true);
  // a never-sold product is still answerable by name (reliability none, purchase 0)
  const never = (await run({ productQuery: "Jamais" })) as { found: boolean; products: Array<Record<string, unknown>> };
  assert.equal(never.found, true);
  assert.equal(never.products[0].reliability, "none");
});

test("12. the engine runs once per request, whatever the number of tool calls", async () => {
  const calls: unknown[] = [];
  const run = createPurchaseToolRunner(engine(DATASET, calls));
  await Promise.all([run({}), run({ productQuery: "Coca" }), run({ includeNoPurchase: true }), run({ maxProducts: 3 })]);
  await run({ includeNeverSold: true });
  assert.equal(calls.length, 1);
});

test("2. the organisation is never an argument: unknown or organisation-like parameters are refused, the engine gets no organisation", async () => {
  assert.equal(purchaseRecommendationsArgumentsSchema.safeParse({ organizationId: "org_x" }).success, false);
  assert.equal(purchaseRecommendationsArgumentsSchema.safeParse({ maxProducts: 0 }).success, false);
  assert.equal(purchaseRecommendationsArgumentsSchema.safeParse({ maxProducts: 51 }).success, false);
  assert.equal(purchaseRecommendationsArgumentsSchema.safeParse({ maxProducts: 10, includeNoPurchase: true }).success, true);
  const calls: unknown[] = [];
  const run = createPurchaseToolRunner(engine(DATASET, calls));
  const refused = (await run({ organizationId: "org_x" })) as { error?: string };
  assert.ok(refused.error);
  assert.equal(calls.length, 0, "an invalid call never reaches the engine");
  await run({});
  assert.deepEqual(calls, [{ includeNeverSold: true }], "the engine receives options only, no organisation");
  const properties = (purchaseRecommendationsDeclaration.parametersJsonSchema as { properties: Record<string, unknown> }).properties;
  assert.equal("organizationId" in properties, false);
  // the session-scoped engine entry point takes the organisation from requireOrganizationUser
  const server = read("./purchase-recommendation.ts");
  assert.match(server, /requireOrganizationUser\(\["admin", "depot_manager"\]\)/);
  assert.match(server, /user\.organizationId/);
  assert.equal(/organizationId\?:|organizationId:\s*string/.test(server), false, "no organisation parameter");
});

test("5+6. wiring: the tool is declared and dispatched in the chat route, and the instructions say when to call it and when not to", () => {
  const route = read("../../app/api/ai/chat/route.ts");
  assert.match(route, /purchaseRecommendationsDeclaration,\n\];|purchaseRecommendationsDeclaration,\r\n\];/);
  assert.match(route, /functionCall\.name === PURCHASE_TOOL_NAME/);
  assert.match(route, /createPurchaseToolRunner\(\{ getPurchaseRecommendations \}\)/);
  assert.match(route, /\$\{PURCHASE_TOOL_INSTRUCTIONS\}/);
  assert.match(route, /from "@\/lib\/server\/purchase-recommendation"/);
  assert.equal(PURCHASE_TOOL_NAME, "get_purchase_recommendations");

  const prompt = PURCHASE_TOOL_INSTRUCTIONS.toLowerCase();
  for (const question of [
    "qu'est-ce que je dois acheter cette semaine",
    "quels produits dois-je commander",
    "combien dois-je acheter",
    "quels produits vont bientôt manquer",
    "quels produits ont un stock insuffisant",
    "donne-moi les recommandations d'achat",
    "combien de coca 2l dois-je acheter",
  ]) {
    assert.ok(prompt.includes(question), question);
  }
  assert.match(PURCHASE_TOOL_INSTRUCTIONS, /N'appelle jamais cette fonction pour une question sans rapport avec les achats/);
  assert.match(PURCHASE_TOOL_INSTRUCTIONS, /UNE SEULE fois/);
  assert.match(PURCHASE_TOOL_INSTRUCTIONS, /Tu ne calcules JAMAIS toi-même/);
  assert.match(PURCHASE_TOOL_INSTRUCTIONS, /Stock négatif à régulariser/);
  assert.match(PURCHASE_TOOL_INSTRUCTIONS, /n'écris jamais « achetez »/);
  assert.match(PURCHASE_TOOL_INSTRUCTIONS, /multipleMatches/);
  assert.match(PURCHASE_TOOL_INSTRUCTIONS, /reliabilityLabel/);
  assert.match(purchaseRecommendationsDeclaration.description ?? "", /Ne l'utilise pas pour une question sans rapport/);
  // the old stock-alert tool keeps its own role
  assert.match(route, /list_low_stock_products \(les produits qui vont bientôt manquer/);
});

// ---------------------------------------------------------------------------
// Real database (rolled back): organisation isolation and the negative-stock rule end to end
// ---------------------------------------------------------------------------

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
const uid = () => randomUUID().slice(0, 8);

async function makeOrganization(tx: Tx, label: string) {
  const suffix = uid();
  const organization = await tx.organization.create({ data: { code: `T-${label}-${suffix}`, name: `Test ${label}` } });
  const user = await tx.user.create({
    data: { organizationId: organization.id, firstName: "T", lastName: label, fullName: `T ${label}`, email: `t-${label}-${suffix}@example.invalid`, passwordHash: "x", role: "ADMIN" },
  });
  const depot = await tx.depot.create({ data: { organizationId: organization.id, code: `D-${suffix}`, name: "Depot", address: "-", city: "-" } });
  const location = await tx.stockLocation.create({ data: { organizationId: organization.id, code: `L-${suffix}`, name: "Depot", type: "DEPOT", depotId: depot.id } });
  const category = await tx.category.create({ data: { organizationId: organization.id, name: "Cat" } });
  return { organization, user, location, category };
}
type Ctx = Awaited<ReturnType<typeof makeOrganization>>;

async function seedProduct(tx: Tx, ctx: Ctx, name: string, dailyQuantity: number, stock: number, lastDay: string) {
  const product = await tx.product.create({
    data: { organizationId: ctx.organization.id, reference: `R-${uid()}`, name, categoryId: ctx.category.id, purchasePrice: 5, salePrice: 10, taxRate: 20, unit: "u" },
  });
  const sales: Array<Record<string, unknown>> = [];
  const lines: Array<Record<string, unknown>> = [];
  for (let i = 0; i < 90; i += 1) {
    const id = randomUUID();
    sales.push({
      id,
      organizationId: ctx.organization.id,
      invoiceNumber: `T-${uid()}-${i}`,
      origin: "COUNTER",
      status: "PAID",
      stockLocationId: ctx.location.id,
      subtotalHT: 0,
      taxAmount: 0,
      totalTTC: 0,
      paymentMethod: "CASH",
      createdByUserId: ctx.user.id,
      validatedAt: new Date(`${addDays(lastDay, -(89 - i))}T12:00:00Z`),
    });
    lines.push({ saleId: id, productId: product.id, quantity: dailyQuantity, unitPriceHT: 10, unitCostHT: 5, taxRate: 20, taxAmount: 0, totalHT: 0, totalTTC: 0 });
  }
  await tx.sale.createMany({ data: sales as never });
  await tx.saleLine.createMany({ data: lines as never });
  await tx.stockLevel.create({ data: { organizationId: ctx.organization.id, productId: product.id, locationId: ctx.location.id, quantity: stock } });
  return product;
}

test("3+4. real database: each organisation's tool only sees its own products; a negative stock is flagged and never bought", async (t) => {
  if (!reachable) return t.skip("database unreachable");

  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        const a = await makeOrganization(tx, "A");
        const b = await makeOrganization(tx, "B");
        const asOf = "2025-06-30";
        await seedProduct(tx, a, "Coca 2L", 5, 12, asOf); // 35 forecast, target 35, stock 12 -> 23
        await seedProduct(tx, a, "Coca 1L", 5, -12, asOf); // negative stock
        await seedProduct(tx, b, "Fanta B", 500, 0, asOf);

        const db = tx as unknown as ForecastDb;
        const toolFor = (organizationId: string) =>
          createPurchaseToolRunner({ getPurchaseRecommendations: (options) => buildPurchaseRecommendationsLive(db, organizationId, { ...options, asOf }) });

        const a1 = (await toolFor(a.organization.id)({})) as {
          toBuy: Array<Record<string, unknown>>;
          negativeStock: Array<Record<string, unknown>>;
        };
        assert.deepEqual(a1.toBuy.map((x) => x.productName), ["Coca 2L"]);
        assert.equal(a1.toBuy[0].recommendedPurchase, 23);
        assert.equal(a1.toBuy[0].currentStock, 12);
        assert.equal(a1.toBuy[0].forecast7Days, 35);
        assert.equal(a1.negativeStock.length, 1);
        assert.equal(a1.negativeStock[0].productName, "Coca 1L");
        assert.equal(a1.negativeStock[0].currentStock, -12);
        assert.equal(a1.negativeStock[0].recommendedPurchase, 0);
        assert.equal(a1.negativeStock[0].stockAlert, "Stock négatif à régulariser");

        const b1 = (await toolFor(b.organization.id)({})) as { toBuy: Array<Record<string, unknown>> };
        assert.deepEqual(b1.toBuy.map((x) => x.productName), ["Fanta B"]);
        assert.equal(b1.toBuy[0].recommendedPurchase, 3500);
        // neither organisation sees the other's products, even by name
        const cross = (await toolFor(a.organization.id)({ productQuery: "Fanta" })) as { found: boolean };
        assert.equal(cross.found, false);
        const crossB = (await toolFor(b.organization.id)({ productQuery: "Coca" })) as { found: boolean };
        assert.equal(crossB.found, false);

        throw new Rollback("rollback");
      },
      { timeout: 240_000, maxWait: 30_000 },
    ),
    (error: unknown) => error instanceof Rollback,
  );
});
