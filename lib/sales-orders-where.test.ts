import assert from "node:assert/strict";
import { test } from "node:test";

import { buildOrdersWhere } from "@/lib/sales-orders-where";

const ORG = "org-1";

test("archives exclude DRAFT (BROUILLON) sales in the query itself", () => {
  const where = buildOrdersWhere(ORG, {});
  assert.equal(where.organizationId, ORG);
  assert.deepEqual(where.status, { not: "DRAFT" });
});

test("only DRAFT is excluded: PAID, CREDIT, PARTIALLY_PAID, VALIDATED, CANCELLED, CREDIT_NOTED stay listable", () => {
  const where = buildOrdersWhere(ORG, {});
  assert.deepEqual(where.status, { not: "DRAFT" });
  // "not DRAFT" is the only status condition: no allow-list that could drop a status.
  assert.equal(Object.keys(where.status as object).length, 1);
});

test("includeDrafts opts back in (internal callers only)", () => {
  const where = buildOrdersWhere(ORG, { includeDrafts: true });
  assert.equal("status" in where, false);
});

test("search, dates, payment method and session filters combine with the draft exclusion", () => {
  const where = buildOrdersWhere(ORG, {
    search: "  VC-12 ",
    dateFrom: "2026-09-01",
    dateTo: "2026-09-30",
    paymentMethod: "CASH",
    posSessionId: "sess-1",
  });
  assert.deepEqual(where.status, { not: "DRAFT" });
  assert.equal(where.paymentMethod, "CASH");
  assert.equal(where.posSessionId, "sess-1");
  assert.ok(where.createdAt && typeof where.createdAt === "object");
  const range = where.createdAt as { gte: Date; lte: Date };
  assert.equal(range.gte.toISOString().slice(0, 10), "2026-09-01");
  assert.equal(range.lte.getHours(), 23);
  assert.equal(Array.isArray(where.OR) && where.OR.length, 4);
  assert.deepEqual(
    (where.OR as Array<{ invoiceNumber?: { contains: string } }>)[0].invoiceNumber?.contains,
    "VC-12",
  );
});

test('paymentMethod "all" adds no payment filter but keeps the draft exclusion', () => {
  const where = buildOrdersWhere(ORG, { paymentMethod: "all" });
  assert.equal("paymentMethod" in where, false);
  assert.deepEqual(where.status, { not: "DRAFT" });
});

test("every query stays scoped to the organization", () => {
  for (const params of [{}, { includeDrafts: true }, { search: "x" }]) {
    assert.equal(buildOrdersWhere(ORG, params).organizationId, ORG);
  }
});
