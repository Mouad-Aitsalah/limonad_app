import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/lib/generated/prisma/client";
import {
  aiPosDraftExpiry,
  type AiPosDraftLine,
  type CustomerCandidate,
  type ProductCandidate,
} from "@/lib/assistant-pos-draft-rules";

import { createPrismaAiPosDraftStore } from "./assistant-pos-draft-store";
import {
  AiPosDraftConflictError,
  POS_DRAFT_TOOL_INSTRUCTIONS,
  POS_DRAFT_TOOL_NAME,
  createPosDraftToolRunner,
  preparePosSaleArgumentsSchema,
  preparePosSaleDeclaration,
  type AiPosDraftStore,
  type StoredAiPosDraft,
} from "./assistant-pos-draft-tool";

/**
 * prepare_pos_sale end to end, minus Gemini: the arguments below are exactly
 * what the model sends for each sentence (text queries + quantities only).
 * Part 1 runs on an in-memory store; part 2 on the real (local) database,
 * inside a transaction that is always rolled back.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

type FakeDraft = StoredAiPosDraft & { conversationId: string };

function createFakeStore(options: {
  products: ProductCandidate[];
  customers: CustomerCandidate[];
  stock?: Record<string, number>;
  conversationId?: string;
  drafts?: FakeDraft[];
  now?: () => Date;
}) {
  const conversationId = options.conversationId ?? "conv-1";
  const drafts: FakeDraft[] = options.drafts ?? [];
  const now = options.now ?? (() => new Date("2026-10-07T10:00:00Z"));
  const writes: string[] = [];
  let sequence = drafts.length;

  const store: AiPosDraftStore = {
    async loadCurrentDraft() {
      const mine = drafts.filter((draft) => draft.conversationId === conversationId);
      const row = mine.find((draft) => draft.status === "OPEN") ?? mine.at(-1) ?? null;
      if (row && row.status === "OPEN" && row.expiresAt <= now()) row.status = "EXPIRED";
      return row ? { ...row, lines: row.lines.map((line) => ({ ...line })) } : null;
    },
    async findProductCandidates() {
      return options.products;
    },
    async getProductsByIds(ids) {
      return options.products.filter((product) => ids.includes(product.id));
    },
    async findCustomerCandidates(query) {
      const exactNumberMatch = options.customers.find((item) => item.code === query.trim()) ?? null;
      return { exactNumberMatch, candidates: exactNumberMatch ? [] : options.customers };
    },
    async getCustomer(id) {
      return options.customers.find((item) => item.id === id) ?? null;
    },
    async getAvailableStock(productIds) {
      return new Map(productIds.map((id) => [id, options.stock?.[id] ?? 100]));
    },
    async saveDraft({ expectedDraftId, lines, customerId }) {
      const open = drafts.find((draft) => draft.conversationId === conversationId && draft.status === "OPEN");
      if (expectedDraftId && open?.id !== expectedDraftId) throw new AiPosDraftConflictError();
      writes.push("AiPosDraft");
      const expiresAt = aiPosDraftExpiry(now());
      if (open) {
        Object.assign(open, { lines, customerId, expiresAt });
        return { id: open.id, expiresAt };
      }
      sequence += 1;
      const created: FakeDraft = { id: `draft-${sequence}`, conversationId, status: "OPEN", lines, customerId, expiresAt };
      drafts.push(created);
      return { id: created.id, expiresAt };
    },
  };
  return { store, drafts, writes };
}

const P = (id: string, name: string, reference = id.toUpperCase()): ProductCandidate => ({ id, name, reference, barcode: null });
const C = (id: string, name: string, code: string): CustomerCandidate => ({ id, name, code, displayCode: code });

const PRODUCTS = [P("coca", "Coca-Cola"), P("hawai", "Hawaii"), P("poms", "Pom's"), P("sidi", "Sidi Ali 1.5L")];
const CUSTOMERS = [C("autre", "Autre", "34211"), C("karim", "Karim", "34212"), C("atlas", "Épicerie Atlas", "34213")];

/** "dir lia factura fiha 2 coca 2 hawai 2 poms l client autre", as the model sends it. */
const DIR_LIA_FACTURA = {
  mode: "new",
  customerQuery: "autre",
  items: [
    { action: "add", productQuery: "coca", quantity: 2 },
    { action: "add", productQuery: "hawai", quantity: 2 },
    { action: "add", productQuery: "poms", quantity: 2 },
  ],
};

// ---------------------------------------------------------------------------
// Part 1 - the flow
// ---------------------------------------------------------------------------

test("1+3+9+10. « dir lia factura fiha 2 coca 2 hawai 2 poms l client autre » prepares a draft: client Autre, ids + quantities only", async () => {
  const { store, drafts, writes } = createFakeStore({ products: PRODUCTS, customers: CUSTOMERS });
  const result = await createPosDraftToolRunner(store)(DIR_LIA_FACTURA);

  assert.equal(result.prepared, true);
  assert.deepEqual(result.customer, { name: "Autre", code: "34211" });
  assert.deepEqual(result.lines, [
    { productName: "Coca-Cola", reference: "COCA", quantity: 2 },
    { productName: "Hawaii", reference: "HAWAI", quantity: 2 },
    { productName: "Pom's", reference: "POMS", quantity: 2 },
  ]);
  assert.equal(drafts.length, 1);
  assert.deepEqual(drafts[0].lines, [
    { productId: "coca", quantity: 2 },
    { productId: "hawai", quantity: 2 },
    { productId: "poms", quantity: 2 },
  ]);
  assert.equal(drafts[0].customerId, "autre");
  for (const line of drafts[0].lines) assert.deepEqual(Object.keys(line).sort(), ["productId", "quantity"]);
  assert.deepEqual(writes, ["AiPosDraft"], "the only write is the draft");

  const summary = String(result.summaryMarkdown);
  for (const expected of ["✅ **Vente préparée**", "**Client :** Autre", "- Coca-Cola × 2", "- Hawaii × 2", "- Pom\\'s × 2".replace("\\'", "'"), "[🛒 Ouvrir le panier](/pos?aiDraft=draft-1)"]) {
    assert.ok(summary.includes(expected), `summary: ${expected}`);
  }
  assert.doesNotMatch(summary, /\bDH\b|MAD|TTC :|Total/, "no price or total in the recap");
  assert.equal(result.href, "/pos?aiDraft=draft-1");
});

test("2. darija + français: « sawb lia vente dyal 2 coca w 2 hawai » (no customer -> POS default customer)", async () => {
  const { store, drafts } = createFakeStore({ products: PRODUCTS, customers: CUSTOMERS });
  const result = await createPosDraftToolRunner(store)({
    mode: "new",
    items: [
      { action: "add", productQuery: "coca", quantity: 2 },
      { action: "add", productQuery: "hawai", quantity: 2 },
    ],
  });
  assert.equal(result.prepared, true);
  assert.equal(result.customer, null);
  assert.equal(drafts[0].customerId, null);
  assert.match(String(result.summaryMarkdown), /\*\*Client :\*\* client par défaut du POS/);
});

test("4. a unique product is chosen even with accents/apostrophes (Hawaï / Pom's typed hawai / poms)", async () => {
  const products = [P("h", "Hawaï Tropical"), P("p", "Pom's 33cl"), P("c", "Coca-Cola 1L")];
  const { store, drafts } = createFakeStore({ products, customers: CUSTOMERS });
  const result = await createPosDraftToolRunner(store)({
    mode: "new",
    items: [
      { action: "add", productQuery: "HAWAI", quantity: 1 },
      { action: "add", productQuery: "poms", quantity: 3 },
    ],
  });
  assert.equal(result.prepared, true);
  assert.deepEqual(drafts[0].lines, [
    { productId: "h", quantity: 1 },
    { productId: "p", quantity: 3 },
  ]);
});

test("5. ambiguous product: nothing is saved, the candidates (max 5) are returned for the user to choose", async () => {
  const products = [P("c33", "Coca-Cola 33cl"), P("c1", "Coca-Cola 1L"), P("c15", "Coca-Cola 1.5L"), P("hawai", "Hawaii")];
  const { store, drafts, writes } = createFakeStore({ products, customers: CUSTOMERS });
  const result = await createPosDraftToolRunner(store)({
    mode: "new",
    items: [
      { action: "add", productQuery: "coca", quantity: 2 },
      { action: "add", productQuery: "hawai", quantity: 2 },
    ],
  });
  assert.equal(result.prepared, false);
  assert.equal(result.needsClarification, true);
  const issues = result.productIssues as Array<{ productQuery: string; problem: string; candidates: Array<{ name: string }> }>;
  assert.equal(issues.length, 1);
  assert.equal(issues[0].problem, "ambiguous");
  assert.deepEqual(issues[0].candidates.map((item) => item.name).sort(), ["Coca-Cola 1.5L", "Coca-Cola 1L", "Coca-Cola 33cl"]);
  assert.equal(drafts.length, 0);
  assert.deepEqual(writes, []);

  // the user answers "coca 1L": the model re-sends the full request with the precise query
  const retry = await createPosDraftToolRunner(store)({
    mode: "new",
    items: [
      { action: "add", productQuery: "coca 1L", quantity: 2 },
      { action: "add", productQuery: "hawai", quantity: 2 },
    ],
  });
  assert.equal(retry.prepared, true);
  assert.deepEqual(drafts[0].lines[0], { productId: "c1", quantity: 2 });
});

test("6. ambiguous customer: nothing is saved", async () => {
  const customers = [C("k1", "Karim Alaoui", "34221"), C("k2", "Karim Bennani", "34222")];
  const { store, drafts } = createFakeStore({ products: PRODUCTS, customers });
  const result = await createPosDraftToolRunner(store)({ ...DIR_LIA_FACTURA, customerQuery: "karim" });
  assert.equal(result.needsClarification, true);
  assert.equal((result.customerIssue as { problem: string }).problem, "ambiguous");
  assert.equal(drafts.length, 0);
});

test("7+8. product / customer not found: clearly reported, nothing saved, no customer ever created", async () => {
  const { store, drafts, writes } = createFakeStore({ products: PRODUCTS, customers: CUSTOMERS });
  const runner = createPosDraftToolRunner(store);

  const noProduct = await runner({ mode: "new", items: [{ action: "add", productQuery: "fanta", quantity: 1 }] });
  assert.equal(noProduct.needsClarification, true);
  assert.deepEqual(noProduct.productIssues, [{ productQuery: "fanta", problem: "not_found" }]);

  const noCustomer = await runner({ ...DIR_LIA_FACTURA, customerQuery: "Youssef" });
  assert.deepEqual(noCustomer.customerIssue, { customerQuery: "Youssef", problem: "not_found" });

  assert.equal(drafts.length, 0);
  assert.deepEqual(writes, []);
  assert.equal("createCustomer" in store, false, "the store has no way to create a customer");
});

test("17-20. edit commands on the SAME draft: zid 2 coca, na9es wa7ed coca, 7yed poms, bdel client Karim", async () => {
  const { store, drafts } = createFakeStore({ products: PRODUCTS, customers: CUSTOMERS });
  const runner = createPosDraftToolRunner(store);
  await runner(DIR_LIA_FACTURA);
  const id = drafts[0].id;

  const zid = await runner({ mode: "edit", items: [{ action: "add", productQuery: "coca", quantity: 2 }] });
  assert.equal(zid.prepared, true);
  assert.match(String(zid.summaryMarkdown), /✅ \*\*Panier mis à jour\*\*/);
  assert.deepEqual(drafts[0].lines.find((line) => line.productId === "coca"), { productId: "coca", quantity: 4 });

  await runner({ mode: "edit", items: [{ action: "decrease", productQuery: "coca", quantity: 1 }] });
  assert.equal(drafts[0].lines.find((line) => line.productId === "coca")?.quantity, 3);

  await runner({ mode: "edit", items: [{ action: "remove", productQuery: "poms" }] });
  assert.equal(drafts[0].lines.some((line) => line.productId === "poms"), false);

  const bdel = await runner({ mode: "edit", customerQuery: "Karim" });
  assert.deepEqual(bdel.customer, { name: "Karim", code: "34212" });
  assert.equal(drafts[0].customerId, "karim");

  assert.equal(drafts.length, 1, "one single draft for the conversation");
  assert.equal(drafts[0].id, id);
  assert.deepEqual(drafts[0].lines, [
    { productId: "coca", quantity: 3 },
    { productId: "hawai", quantity: 2 },
  ]);
});

test("one OPEN draft per conversation: « dir lia 2 coca » then « zid 3 hawai » edit it; a new sale replaces its contents", async () => {
  const { store, drafts } = createFakeStore({ products: PRODUCTS, customers: CUSTOMERS });
  const runner = createPosDraftToolRunner(store);
  await runner({ mode: "new", items: [{ action: "add", productQuery: "coca", quantity: 2 }] });
  await runner({ mode: "edit", items: [{ action: "add", productQuery: "hawai", quantity: 3 }] });
  assert.equal(drafts.length, 1);
  assert.deepEqual(drafts[0].lines, [
    { productId: "coca", quantity: 2 },
    { productId: "hawai", quantity: 3 },
  ]);
  await runner({ mode: "new", items: [{ action: "add", productQuery: "sidi", quantity: 1 }] });
  assert.equal(drafts.filter((draft) => draft.status === "OPEN").length, 1);
  assert.deepEqual(drafts[0].lines, [{ productId: "sidi", quantity: 1 }]);
});

test("edit prefers the product already in the cart (« zid 2 coca » when the cart holds one Coca among several)", async () => {
  const products = [P("c33", "Coca-Cola 33cl"), P("c1", "Coca-Cola 1L")];
  const { store, drafts } = createFakeStore({ products, customers: CUSTOMERS });
  const runner = createPosDraftToolRunner(store);
  await runner({ mode: "new", items: [{ action: "add", productQuery: "coca 1l", quantity: 1 }] });
  const zid = await runner({ mode: "edit", items: [{ action: "add", productQuery: "coca", quantity: 2 }] });
  assert.equal(zid.prepared, true);
  assert.deepEqual(drafts[0].lines, [{ productId: "c1", quantity: 3 }]);

  const notInCart = await runner({ mode: "edit", items: [{ action: "remove", productQuery: "poms" }] });
  assert.deepEqual(notInCart.productIssues, [{ productQuery: "poms", problem: "not_in_cart" }]);
});

test("22. a draft already opened in the POS (APPLIED) is never edited from the chat", async () => {
  const applied: FakeDraft = {
    id: "draft-1",
    conversationId: "conv-1",
    status: "APPLIED",
    lines: [{ productId: "coca", quantity: 2 }],
    customerId: null,
    expiresAt: new Date("2026-10-07T11:00:00Z"),
  };
  const { store, drafts } = createFakeStore({ products: PRODUCTS, customers: CUSTOMERS, drafts: [applied] });
  const runner = createPosDraftToolRunner(store);
  const zid = await runner({ mode: "edit", items: [{ action: "add", productQuery: "coca", quantity: 2 }] });
  assert.equal(zid.prepared, false);
  assert.equal(zid.alreadyApplied, true);
  assert.deepEqual(applied.lines, [{ productId: "coca", quantity: 2 }], "untouched");

  // a brand-new sale is still possible: it is a NEW draft
  const fresh = await runner({ mode: "new", items: [{ action: "add", productQuery: "sidi", quantity: 1 }] });
  assert.equal(fresh.prepared, true);
  assert.equal(drafts.length, 2);
  assert.notEqual(fresh.draftId, "draft-1");
});

test("21. an expired draft is not edited (decrease / remove / customer change refused)", async () => {
  const old: FakeDraft = {
    id: "draft-1",
    conversationId: "conv-1",
    status: "OPEN",
    lines: [{ productId: "coca", quantity: 2 }],
    customerId: null,
    expiresAt: new Date("2026-10-07T09:00:00Z"),
  };
  const { store } = createFakeStore({ products: PRODUCTS, customers: CUSTOMERS, drafts: [old] });
  const result = await createPosDraftToolRunner(store)({ mode: "edit", items: [{ action: "decrease", productQuery: "coca" }] });
  assert.equal(result.prepared, false);
  assert.equal(result.noOpenDraft, true);
  assert.match(String(result.error), /expiré/);
  assert.equal(old.status, "EXPIRED");
});

test("a concurrent POS opening between read and write is a conflict, not a silent second draft", async () => {
  const { store } = createFakeStore({ products: PRODUCTS, customers: CUSTOMERS });
  const runner = createPosDraftToolRunner(store);
  await runner(DIR_LIA_FACTURA);
  const racing: AiPosDraftStore = {
    ...store,
    saveDraft: async () => {
      throw new AiPosDraftConflictError();
    },
  };
  const result = await createPosDraftToolRunner(racing)({ mode: "edit", items: [{ action: "add", productQuery: "coca", quantity: 1 }] });
  assert.equal(result.prepared, false);
  assert.equal(result.alreadyApplied, true);
});

test("stock: a quantity above the stock is a warning in the recap, never a block", async () => {
  const { store } = createFakeStore({ products: PRODUCTS, customers: CUSTOMERS, stock: { coca: 1 } });
  const result = await createPosDraftToolRunner(store)(DIR_LIA_FACTURA);
  assert.equal(result.prepared, true);
  assert.deepEqual(result.warnings, [
    "⚠️ Il reste seulement 1 Coca-Cola, mais tu demandes 2 unités. Le POS autorise actuellement cette vente.",
  ]);
  assert.match(String(result.summaryMarkdown), /Il reste seulement 1 Coca-Cola/);
});

test("security: the model can never send an id, a price, a stock or the cart state", async () => {
  for (const forged of [
    { ...DIR_LIA_FACTURA, organizationId: "other-org" },
    { ...DIR_LIA_FACTURA, customerId: "autre" },
    { mode: "new", items: [{ action: "add", productQuery: "coca", quantity: 2, productId: "coca" }] },
    { mode: "new", items: [{ action: "add", productQuery: "coca", quantity: 2, price: 1 }] },
    { mode: "new", items: [{ action: "add", productQuery: "coca", quantity: 2, unitPriceHT: 1 }] },
    { mode: "new", lines: [{ productId: "coca", quantity: 2 }] },
    { mode: "new", items: [{ action: "add", productQuery: "coca", quantity: -2 }] },
  ]) {
    assert.equal(preparePosSaleArgumentsSchema.safeParse(forged).success, false, JSON.stringify(forged));
    const { store, drafts } = createFakeStore({ products: PRODUCTS, customers: CUSTOMERS });
    const result = await createPosDraftToolRunner(store)(forged);
    assert.equal(result.prepared, false);
    assert.equal(drafts.length, 0);
  }
  const declared = JSON.stringify(preparePosSaleDeclaration.parametersJsonSchema);
  for (const forbidden of ["productId", "customerId", "price", "organizationId", "userId", "saleId", "stock\""]) {
    assert.equal(declared.includes(forbidden), false, forbidden);
  }
});

test("a missing quantity is asked, never guessed", async () => {
  const { store, drafts } = createFakeStore({ products: PRODUCTS, customers: CUSTOMERS });
  const result = await createPosDraftToolRunner(store)({ mode: "new", items: [{ action: "add", productQuery: "coca" }] });
  assert.equal(result.prepared, false);
  assert.equal(result.missingQuantity, "coca");
  assert.equal(drafts.length, 0);
});

// ---------------------------------------------------------------------------
// The route wiring (source level): create_invoice is gone, prepare_pos_sale is in
// ---------------------------------------------------------------------------

test("route: the assistant can no longer create a sale; prepare_pos_sale is wired with a server-built recap", () => {
  const route = read("../../app/api/ai/chat/route.ts");
  assert.equal(route.includes("createCounterSale"), false, "no sale creation from the assistant");
  assert.equal(route.includes("create_invoice"), false);
  assert.equal(route.includes("build_invoice_preview"), false);
  assert.match(route, /preparePosSaleDeclaration,/);
  assert.match(route, /\$\{POS_DRAFT_TOOL_INSTRUCTIONS\}/);
  assert.match(route, /functionCall\.name === POS_DRAFT_TOOL_NAME/);
  assert.match(route, /createPrismaAiPosDraftStore\(prisma, \{\s+organizationId: user\.organizationId,\s+userId: user\.id,\s+conversationId,/);
  assert.match(route, /const response = preparedDraftSummary \?\? result\.text/);
  assert.match(route, /requireOrganizationUser\(\["admin"\]\)/, "16. permissions: the assistant stays admin-only");
  assert.equal(POS_DRAFT_TOOL_NAME, "prepare_pos_sale");
  assert.match(POS_DRAFT_TOOL_INSTRUCTIONS, /Tu ne peux PAS créer une vente/);
});

test("11-14. the draft modules never touch Sale, Payment, StockMovement, StockLevel or accounting", () => {
  for (const file of ["./assistant-pos-draft-tool.ts", "./assistant-pos-draft-store.ts", "./ai-pos-draft-pos.ts"]) {
    // code only: the doc comments legitimately explain that createCounterSale is NOT called
    const source = read(file)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of [
      /\.sale\./,
      /\.payment\./,
      /\.stockMovement\./,
      /\.accountingEntry/,
      /stockLevel\.(update|create|upsert|delete)/,
      /createCounterSale/,
      /postSaleAccountingEntry/,
    ]) {
      assert.equal(forbidden.test(source), false, `${file}: ${forbidden}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Part 2 - real database (local), always rolled back
// ---------------------------------------------------------------------------

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
let reachable = false;

before(async () => {
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
const uid = () => randomUUID().slice(0, 8);

async function makeOrganization(tx: Tx, label: string) {
  const suffix = uid();
  const organization = await tx.organization.create({ data: { code: `T-${label}-${suffix}`, name: `Test ${label}` } });
  const user = await tx.user.create({
    data: {
      organizationId: organization.id,
      firstName: "T",
      lastName: label,
      fullName: `T ${label}`,
      email: `t-${label}-${suffix}@example.invalid`,
      passwordHash: "x",
      role: "ADMIN",
    },
  });
  const depot = await tx.depot.create({ data: { organizationId: organization.id, code: `D-${suffix}`, name: "Depot", address: "-", city: "-" } });
  await tx.user.update({ where: { id: user.id }, data: { depotId: depot.id } });
  const location = await tx.stockLocation.create({
    data: { organizationId: organization.id, code: `L-${suffix}`, name: "Depot", type: "DEPOT", depotId: depot.id },
  });
  const category = await tx.category.create({ data: { organizationId: organization.id, name: "Cat" } });
  const conversation = await tx.aiConversation.create({ data: { organizationId: organization.id, createdByUserId: user.id } });
  return { organization, user, location, category, conversation };
}
type Ctx = Awaited<ReturnType<typeof makeOrganization>>;

async function seedProduct(tx: Tx, ctx: Ctx, name: string, stock?: number) {
  const product = await tx.product.create({
    data: { organizationId: ctx.organization.id, reference: `R-${uid()}`, name, categoryId: ctx.category.id, purchasePrice: 5, salePrice: 10, taxRate: 20, unit: "u" },
  });
  if (stock !== undefined) {
    await tx.stockLevel.create({ data: { organizationId: ctx.organization.id, productId: product.id, locationId: ctx.location.id, quantity: stock } });
  }
  return product;
}

async function seedCustomer(tx: Tx, ctx: Ctx, name: string, code: string) {
  return tx.customer.create({
    data: { organizationId: ctx.organization.id, code, name, address: "-", city: "-", type: "GROCERY", createdByUserId: ctx.user.id, creationOrigin: "ADMIN" },
  });
}

async function businessCounts(tx: Tx) {
  const [sales, payments, movements, entries, levels] = await Promise.all([
    tx.sale.count(),
    tx.payment.count(),
    tx.stockMovement.count(),
    tx.accountingEntry.count(),
    tx.stockLevel.aggregate({ _sum: { quantity: true }, _count: true }),
  ]);
  return { sales, payments, movements, entries, levels };
}

test("real database: 9-15 + 25. draft created, accent/apostrophe search, product beyond the first 500, nothing else written, organisations isolated", async (t) => {
  if (!reachable) return t.skip("database unreachable");

  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        const a = await makeOrganization(tx, "A");
        const b = await makeOrganization(tx, "B");

        // 520 products in A: the target sorts LAST by name, outside the POS's 500 preload
        await tx.product.createMany({
          data: Array.from({ length: 520 }, (_, index) => ({
            organizationId: a.organization.id,
            reference: `BULK-${uid()}-${index}`,
            name: `Article ${String(index).padStart(3, "0")}`,
            categoryId: a.category.id,
            purchasePrice: 1,
            salePrice: 2,
            taxRate: 20,
            unit: "u",
          })),
        });
        const coca = await seedProduct(tx, a, "Coca-Cola 33cl", 1);
        const hawai = await seedProduct(tx, a, "Hawaï Tropical", 10);
        const poms = await seedProduct(tx, a, "Pom's 33cl");
        const zz = await seedProduct(tx, a, "Zzz Limonade Artisanale", 3);
        const autre = await seedCustomer(tx, a, "Autre", `3421${uid().replace(/\D/g, "1")}`);
        // organisation B has its own "Coca-Cola 33cl", its own "Autre" and a product A does not have
        await seedProduct(tx, b, "Coca-Cola 33cl", 50);
        await seedProduct(tx, b, "Fanta Orange B", 50);
        await seedCustomer(tx, b, "Autre", `3421${uid().replace(/\D/g, "2")}`);

        const position = await tx.product.count({ where: { organizationId: a.organization.id, status: "ACTIVE", name: { lt: zz.name } } });
        assert.ok(position >= 500, "the target is outside the POS's first 500 products");

        const before = await businessCounts(tx);
        const storeA = createPrismaAiPosDraftStore(tx, {
          organizationId: a.organization.id,
          userId: a.user.id,
          conversationId: a.conversation.id,
        });
        const runA = createPosDraftToolRunner(storeA);

        const prepared = await runA(DIR_LIA_FACTURA);
        assert.equal(prepared.prepared, true, JSON.stringify(prepared));
        assert.deepEqual(prepared.customer, { name: "Autre", code: (prepared.customer as { code: string }).code });
        assert.deepEqual(
          (prepared.lines as Array<{ productName: string; quantity: number }>).map((line) => [line.productName, line.quantity]),
          [
            ["Coca-Cola 33cl", 2],
            ["Hawaï Tropical", 2],
            ["Pom's 33cl", 2],
          ],
        );
        assert.deepEqual(prepared.warnings, [
          "⚠️ Il reste seulement 1 Coca-Cola 33cl, mais tu demandes 2 unités. Le POS autorise actuellement cette vente.",
          "⚠️ Il n'en reste plus en stock, mais tu demandes 2 unités. Le POS autorise actuellement cette vente.",
        ]);

        const row = await tx.aiPosDraft.findUniqueOrThrow({ where: { id: String(prepared.draftId) } });
        assert.equal(row.organizationId, a.organization.id);
        assert.equal(row.userId, a.user.id);
        assert.equal(row.status, "OPEN");
        assert.equal(row.customerId, autre.id);
        assert.deepEqual(row.lines as AiPosDraftLine[], [
          { productId: coca.id, quantity: 2 },
          { productId: hawai.id, quantity: 2 },
          { productId: poms.id, quantity: 2 },
        ]);
        assert.ok(row.expiresAt.getTime() > Date.now());

        // product #520+ found, in the same draft
        const zid = await runA({ mode: "edit", items: [{ action: "add", productQuery: "limonade artisanale", quantity: 1 }] });
        assert.equal(zid.prepared, true, JSON.stringify(zid));
        assert.equal(zid.draftId, prepared.draftId, "same draft");
        assert.equal(await tx.aiPosDraft.count({ where: { conversationId: a.conversation.id } }), 1);

        // B's product is invisible from A
        const foreign = await runA({ mode: "edit", items: [{ action: "add", productQuery: "fanta orange", quantity: 1 }] });
        assert.deepEqual(foreign.productIssues, [{ productQuery: "fanta orange", problem: "not_found" }]);

        // B's session cannot see or edit A's draft, even with A's conversation id
        const storeB = createPrismaAiPosDraftStore(tx, {
          organizationId: b.organization.id,
          userId: b.user.id,
          conversationId: a.conversation.id,
        });
        assert.equal(await storeB.loadCurrentDraft(), null);
        const cocaFromB = await storeB.findProductCandidates("coca");
        assert.equal(cocaFromB.some((product) => product.id === coca.id), false);

        // 11-14: no Sale, Payment, StockMovement, accounting entry, no stock change
        assert.deepEqual(await businessCounts(tx), before);
        throw new Rollback();
      },
      { timeout: 60_000, maxWait: 20_000 },
    ),
    Rollback,
  );
});
