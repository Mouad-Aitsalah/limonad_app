import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canViewReceivables } from "@/lib/receivables/access";
import {
  ageInDays,
  allocateFifo,
  balanceFromTotals,
  bucketForAge,
  businessDayOf,
  saleInstant,
  summarizeAging,
  sumMoney,
} from "@/lib/receivables/aging";
import { buildMovements, type MovementInput } from "@/lib/receivables/movements";
import {
  DEFAULT_OVERDUE_DAYS,
  parseReceivablesSettings,
  validateOverdueDays,
  withReceivablesSettings,
} from "@/lib/receivables/settings";
import { matchesDebtorFilter, selectDebtors } from "@/lib/receivables/table";
import { parseProductColumnSettings } from "@/lib/product-columns";
import { parseTableLabels, withPageLabels } from "@/lib/table-labels/labels";
import type { ReceivablesDebtorRow } from "@/types/receivables";

describe("balance (computeCustomerDebt's formula)", () => {
  it("credit sales - credit notes - settlements, clamped at 0, the raw value kept for credit balances", () => {
    assert.deepEqual(balanceFromTotals(1000, 150, 300), { raw: 550, debt: 550 });
    assert.deepEqual(balanceFromTotals(100, 80, 50), { raw: -30, debt: 0 });
    assert.deepEqual(balanceFromTotals(0, 0, 0), { raw: 0, debt: 0 });
    // cents never drift
    assert.deepEqual(balanceFromTotals(0.3, 0.1, 0.1), { raw: 0.1, debt: 0.1 });
  });

  it("sums money exactly", () => {
    assert.equal(sumMoney(Array.from({ length: 1000 }, () => 0.1)), 100);
    assert.equal(sumMoney([]), 0);
  });
});

describe("FIFO allocation", () => {
  const sales = [
    { id: "jan", amount: 1000 },
    { id: "feb", amount: 500 },
    { id: "mar", amount: 300 },
  ];

  it("a partial settlement pays the OLDEST sales first", () => {
    // total 1800, 1200 paid -> 600 open: mar 300 fully + feb 300 of 500, jan paid
    const open = allocateFifo(sales, 600).map((s) => [s.id, s.open]);
    assert.deepEqual(open, [["jan", 0], ["feb", 300], ["mar", 300]]);
  });

  it("nothing paid -> every sale fully open; everything paid -> nothing open", () => {
    assert.deepEqual(allocateFifo(sales, 1800).map((s) => s.open), [1000, 500, 300]);
    assert.deepEqual(allocateFifo(sales, 0).map((s) => s.open), [0, 0, 0]);
  });

  it("the open parts always add up to the debt (cents), never more than the sales", () => {
    for (const debt of [0.01, 299.99, 300, 300.01, 1499.5, 1800]) {
      assert.equal(sumMoney(allocateFifo(sales, debt).map((s) => s.open)), debt, String(debt));
    }
    assert.equal(sumMoney(allocateFifo(sales, 5000).map((s) => s.open)), 1800);
    assert.deepEqual(allocateFifo([], 100), []);
  });
});

describe("dates and aging buckets", () => {
  it("the sale date is soldAt (offline driver sale), else validatedAt, else createdAt", () => {
    const createdAt = new Date("2026-05-10T10:00:00Z");
    const validatedAt = new Date("2026-05-09T10:00:00Z");
    const soldAt = new Date("2026-05-01T10:00:00Z");
    assert.equal(saleInstant({ soldAt, validatedAt, createdAt }), soldAt);
    assert.equal(saleInstant({ soldAt: null, validatedAt, createdAt }), validatedAt);
    assert.equal(saleInstant({ soldAt: null, validatedAt: null, createdAt }), createdAt);
  });

  it("uses the 02:00 Casablanca business day", () => {
    // UTC+1 in May: 01:30 local on the 11th = 00:30Z -> still business day 10
    assert.equal(businessDayOf(new Date("2026-05-11T00:30:00Z")), "2026-05-10");
    assert.equal(businessDayOf(new Date("2026-05-11T01:00:00Z")), "2026-05-11");
  });

  it("bucket boundaries: 30 | 31, 60 | 61, 90 | 91", () => {
    assert.deepEqual([0, 30, 31, 60, 61, 90, 91, 400].map(bucketForAge), ["0-30", "0-30", "31-60", "31-60", "61-90", "61-90", "90+", "90+"]);
    assert.equal(ageInDays("2026-05-01", "2026-05-31"), 30);
    assert.equal(ageInDays("2026-05-01", "2026-06-01"), 31);
    assert.equal(ageInDays("2026-05-01", "2026-05-01"), 0);
    // across a month / year
    assert.equal(ageInDays("2025-12-31", "2026-01-01"), 1);
  });

  it("over 30 days is fixed; the overdue part follows the CONFIGURED delay, independently", () => {
    const parts = [
      { open: 100, ageDays: 10 },
      { open: 200, ageDays: 20 },
      { open: 300, ageDays: 31 },
      { open: 400, ageDays: 95 },
    ];
    const at30 = summarizeAging(parts, 30);
    assert.deepEqual(at30.buckets, { "0-30": 300, "31-60": 300, "61-90": 0, "90+": 400 });
    assert.equal(at30.over30, 700);
    assert.equal(at30.overdue, 700);
    assert.equal(at30.oldestOpenAgeDays, 95);
    assert.equal(at30.total, 1000);

    const at15 = summarizeAging(parts, 15);
    assert.equal(at15.overdue, 900, "a shorter delay makes more debt overdue");
    assert.equal(at15.over30, 700, "the 30-day indicator does not move");
    const at60 = summarizeAging(parts, 60);
    assert.equal(at60.overdue, 400);
    // exactly at the delay is NOT overdue (strictly more than N days)
    assert.equal(summarizeAging([{ open: 50, ageDays: 15 }], 15).overdue, 0);
    assert.equal(summarizeAging([{ open: 50, ageDays: 16 }], 15).overdue, 50);
  });

  it("an empty / fully paid customer has zeros and no oldest age", () => {
    const empty = summarizeAging([{ open: 0, ageDays: 400 }], 30);
    assert.deepEqual([empty.total, empty.overdue, empty.over30, empty.oldestOpenAgeDays], [0, 0, 0, null]);
  });
});

describe("overdue delay setting", () => {
  it("defaults to 30 days when nothing (or something invalid) is stored", () => {
    for (const stored of [null, undefined, {}, { receivables: {} }, { receivables: { overdueDays: 0 } }, { receivables: { overdueDays: 12.5 } }, { receivables: { overdueDays: "45" } }, { receivables: { overdueDays: 400 } }]) {
      assert.deepEqual(parseReceivablesSettings(stored), { overdueDays: DEFAULT_OVERDUE_DAYS, isDefault: true }, JSON.stringify(stored));
    }
    assert.deepEqual(parseReceivablesSettings({ receivables: { overdueDays: 45 } }), { overdueDays: 45, isDefault: false });
  });

  it("accepts whole days 1-365 (also typed as text) and refuses the rest with a message", () => {
    assert.deepEqual(validateOverdueDays(45), { ok: true, value: 45 });
    assert.deepEqual(validateOverdueDays(" 7 "), { ok: true, value: 7 });
    assert.deepEqual(validateOverdueDays(1), { ok: true, value: 1 });
    assert.deepEqual(validateOverdueDays(365), { ok: true, value: 365 });
    for (const bad of [0, -5, 366, 12.5, "abc", "", null, undefined, {}]) {
      const result = validateOverdueDays(bad);
      assert.equal(result.ok, false, String(bad));
    }
  });

  it("is stored next to the /produits columns and the table labels without touching them - and they keep it", () => {
    const stored = { columns: { brand: false }, labels: { sales: { orders: { reference: "N°" } } } };
    const next = withReceivablesSettings(stored, 20);
    assert.deepEqual(next, { ...stored, receivables: { overdueDays: 20 } });
    assert.deepEqual(stored, { columns: { brand: false }, labels: { sales: { orders: { reference: "N°" } } } }, "input not mutated");
    // the two existing writers keep the receivables key
    const afterColumns = { ...next, ...parseProductColumnSettings({ columns: {} }) };
    assert.deepEqual(parseReceivablesSettings(afterColumns), { overdueDays: 20, isDefault: false });
    const afterLabels = withPageLabels(next, "sales", {});
    assert.deepEqual(parseReceivablesSettings(afterLabels), { overdueDays: 20, isDefault: false });
    assert.deepEqual(parseTableLabels(next), parseTableLabels(stored));
  });
});

describe("customer movements", () => {
  const base = { reference: "", label: "" };
  const inputs: MovementInput[] = [
    { ...base, id: "settlement:1", kind: "SETTLEMENT", day: "2026-03-10", sortAt: 3, amount: -400 },
    { ...base, id: "sale:2", kind: "CREDIT_SALE", day: "2026-03-01", sortAt: 2, amount: 500 },
    { ...base, id: "sale:1", kind: "CREDIT_SALE", day: "2026-02-01", sortAt: 1, amount: 1000 },
    { ...base, id: "note:1", kind: "CREDIT_NOTE", day: "2026-03-01", sortAt: 2, amount: -100 },
  ];

  it("orders by business day, then time, then kind (sale before its same-time credit note), with the running balance", () => {
    const { movements, truncated, finalBalance } = buildMovements(inputs);
    assert.deepEqual(movements.map((m) => [m.id, m.balance]), [
      ["sale:1", 1000],
      ["sale:2", 1500],
      ["note:1", 1400],
      ["settlement:1", 1000],
    ]);
    assert.equal(truncated, false);
    assert.equal(finalBalance, 1000);
    assert.equal("sortAt" in movements[0], false, "the ordering key is not sent to the browser");
  });

  it("a long history keeps its true balances behind an opening line", () => {
    const many: MovementInput[] = Array.from({ length: 12 }, (_, i) => ({
      ...base,
      id: `sale:${String(i).padStart(2, "0")}`,
      kind: "CREDIT_SALE" as const,
      day: `2026-01-${String(i + 1).padStart(2, "0")}`,
      sortAt: i,
      amount: 10,
    }));
    const { movements, truncated, finalBalance } = buildMovements(many, 5);
    assert.equal(truncated, true);
    assert.equal(movements.length, 6);
    assert.equal(movements[0].kind, "OPENING");
    assert.equal(movements[0].balance, 70);
    assert.equal(movements.at(-1)!.balance, 120);
    assert.equal(finalBalance, 120);
  });
});

describe("debtors table", () => {
  const row = (overrides: Partial<ReceivablesDebtorRow>): ReceivablesDebtorRow => ({
    customerId: "c",
    name: "Client",
    code: "CLI-0001",
    accountCode: "34211",
    status: "ACTIVE",
    balance: 0,
    overdue: 0,
    over30: 0,
    buckets: { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 },
    oldestOpenAgeDays: null,
    lastSettlementDay: null,
    cashCreditNotesTotal: 0,
    ...overrides,
  });
  const rows = [
    row({ customerId: "a", name: "Épicerie Atlas", code: "3421014", accountCode: "3421014", balance: 500, overdue: 500, over30: 500, oldestOpenAgeDays: 95, buckets: { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 500 } }),
    row({ customerId: "b", name: "Café Zahra", balance: 1200, oldestOpenAgeDays: 3, buckets: { "0-30": 1200, "31-60": 0, "61-90": 0, "90+": 0 } }),
    row({ customerId: "c", name: "Boulangerie", balance: 300, over30: 300, oldestOpenAgeDays: 40, cashCreditNotesTotal: 50, buckets: { "0-30": 0, "31-60": 300, "61-90": 0, "90+": 0 } }),
  ];
  const select = (o: Partial<Parameters<typeof selectDebtors>[1]>) =>
    selectDebtors(rows, { search: "", filter: "all", sort: "balance", direction: "desc", ...o }).map((r) => r.customerId);

  it("sorts by balance, overdue, oldest and name, both ways", () => {
    assert.deepEqual(select({}), ["b", "a", "c"]);
    assert.deepEqual(select({ direction: "asc" }), ["c", "a", "b"]);
    assert.deepEqual(select({ sort: "oldest" }), ["a", "c", "b"]);
    // overdue: a 500, b and c 0 -> ties broken by name (Boulangerie before Café)
    assert.deepEqual(select({ sort: "overdue" }), ["a", "c", "b"]);
    assert.deepEqual(select({ sort: "name", direction: "asc" }), ["c", "b", "a"]);
  });

  it("searches name (accents ignored), code and the short account number", () => {
    assert.deepEqual(select({ search: "epicerie" }), ["a"]);
    assert.deepEqual(select({ search: "zahra" }), ["b"]);
    assert.deepEqual(select({ search: "14" }), ["a"]);
    assert.deepEqual(select({ search: "nobody" }), []);
  });

  it("filters overdue / over 30 / over 90 / cash credit notes", () => {
    assert.deepEqual(select({ filter: "overdue" }), ["a"]);
    assert.deepEqual(select({ filter: "over30" }), ["a", "c"]);
    assert.deepEqual(select({ filter: "over90" }), ["a"]);
    assert.deepEqual(select({ filter: "cashNotes" }), ["c"]);
    assert.equal(matchesDebtorFilter(rows[1], "all"), true);
  });
});

describe("access", () => {
  it("only the administrator sees the receivables", () => {
    assert.equal(canViewReceivables("admin"), true);
    for (const role of ["cashier", "depot_manager", "driver", "super_admin", "", null, undefined]) {
      assert.equal(canViewReceivables(role as Parameters<typeof canViewReceivables>[0]), false, String(role));
    }
  });
});
