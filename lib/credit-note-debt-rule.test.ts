import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  CASH_REFUND_DEBT_CUTOVER,
  CASH_REFUND_DEBT_CUTOVER_ISO,
  LEGACY_CREDIT_NOTE_VALIDATION_FLOOR,
  cashRefundNotDeductedWhere,
  creditNoteReducesDebt,
  debtReducingCreditNoteWhere,
  parseCashRefundDebtCutover,
  resolveCutover,
} from "@/lib/credit-note-debt-rule";

/**
 * Lot 2 - which validated customer credit notes reduce the debt. Pure: the rule, its time
 * boundaries, the dormant constant and the guards that stop a wrong cutover. The database
 * behaviour is proven in lib/server/customer-debt-cutover.integration.test.ts.
 */

const T = new Date("2026-11-02T08:30:00.000Z");
const at = (offsetMs: number) => new Date(T.getTime() + offsetMs);

test("the shared constant is NULL: the rule is dormant until the date is confirmed", () => {
  assert.equal(CASH_REFUND_DEBT_CUTOVER_ISO, null);
  assert.equal(CASH_REFUND_DEBT_CUTOVER, null);
  assert.equal(resolveCutover(undefined), null);
  assert.equal(resolveCutover({}), null);
});

test("dormant (null): EVERY validated customer note reduces the debt - exactly the historical behaviour - and the filter adds nothing", () => {
  for (const refundMethod of ["CASH", "BANK"] as const) {
    for (const validatedAt of [null, new Date("2026-01-01T00:00:00Z"), new Date("2030-01-01T00:00:00Z")]) {
      assert.equal(creditNoteReducesDebt({ refundMethod, validatedAt }, null), true);
    }
  }
  assert.deepEqual(debtReducingCreditNoteWhere(null), {}, "no extra condition: the query is the historical one");
  assert.deepEqual(debtReducingCreditNoteWhere(), {}, "and so is the default, since the shared constant is null");
});

test("active cutover - the time boundaries: before counts, EXACTLY at the cutover and after do not (cash refund)", () => {
  assert.equal(creditNoteReducesDebt({ refundMethod: "CASH", validatedAt: at(-1) }, T), true, "1 ms before: historical treatment");
  assert.equal(creditNoteReducesDebt({ refundMethod: "CASH", validatedAt: at(0) }, T), false, "at the cutover: new rule");
  assert.equal(creditNoteReducesDebt({ refundMethod: "CASH", validatedAt: at(1) }, T), false, "1 ms after: new rule");
  assert.equal(creditNoteReducesDebt({ refundMethod: "CASH", validatedAt: at(-86_400_000) }, T), true, "a day before");
  assert.equal(creditNoteReducesDebt({ refundMethod: "CASH", validatedAt: at(86_400_000) }, T), false, "a day after");
});

test("active cutover - an account credit (BANK) always reduces the debt, before or after", () => {
  for (const offset of [-86_400_000, -1, 0, 1, 86_400_000]) {
    assert.equal(creditNoteReducesDebt({ refundMethod: "BANK", validatedAt: at(offset) }, T), true, `offset ${offset}`);
  }
});

test("active cutover - a validated note WITHOUT a validation date keeps the historical treatment, cash or not", () => {
  assert.equal(creditNoteReducesDebt({ refundMethod: "CASH", validatedAt: null }, T), true);
  assert.equal(creditNoteReducesDebt({ refundMethod: "BANK", validatedAt: null }, T), true);
});

test("the Prisma filter says the same as the pure rule: BANK, or no date, or validated strictly before the cutover", () => {
  assert.deepEqual(debtReducingCreditNoteWhere(T), {
    OR: [{ refundMethod: "BANK" }, { validatedAt: null }, { validatedAt: { lt: T } }],
  });
  assert.deepEqual(cashRefundNotDeductedWhere(T), { refundMethod: "CASH", validatedAt: { gte: T } });
  // `lt` / `gte` are complementary on the same instant: no note can be both deducted and not deducted
  assert.equal((debtReducingCreditNoteWhere(T).OR as Array<{ validatedAt?: { lt: Date } }>)[2].validatedAt?.lt, T);
  assert.equal(cashRefundNotDeductedWhere(T).validatedAt && (cashRefundNotDeductedWhere(T).validatedAt as { gte: Date }).gte, T);
});

test("an explicit override wins over the shared constant (tests only), including an explicit null", () => {
  assert.equal(resolveCutover({ cutover: T }), T);
  assert.equal(resolveCutover({ cutover: null }), null);
});

test("parse: only a valid ISO instant in UTC, at or after the floor, is accepted; null is dormant", () => {
  assert.equal(parseCashRefundDebtCutover(null), null);
  assert.equal(parseCashRefundDebtCutover("2026-11-02T08:30:00Z")?.toISOString(), "2026-11-02T08:30:00.000Z");
  assert.equal(parseCashRefundDebtCutover("2026-11-02T08:30:00.250Z")?.toISOString(), "2026-11-02T08:30:00.250Z");
  for (const bad of ["", "2026-11-02", "2026-11-02T08:30:00", "2026-11-02T08:30:00+01:00", "02/11/2026", "not a date", "2026-13-45T25:61:61Z", "2026-11-02 08:30:00Z"]) {
    assert.throws(() => parseCashRefundDebtCutover(bad), /ISO instant in UTC/, bad);
  }
});

test("the floor: a cutover before the last historical validation would change a balance - refused", () => {
  assert.equal(LEGACY_CREDIT_NOTE_VALIDATION_FLOOR.toISOString(), "2026-10-13T14:57:36.000Z");
  assert.equal(parseCashRefundDebtCutover("2026-10-13T14:57:36Z")?.getTime(), LEGACY_CREDIT_NOTE_VALIDATION_FLOOR.getTime(), "the floor itself is allowed");
  assert.throws(() => parseCashRefundDebtCutover("2026-10-13T14:57:35Z"), /would change an existing balance/);
  assert.throws(() => parseCashRefundDebtCutover("2026-08-15T12:00:00Z"), /would change an existing balance/);
  assert.throws(() => parseCashRefundDebtCutover("2020-01-01T00:00:00Z"), /would change an existing balance/);
});

test("the four real historical notes of the production audit all keep reducing the debt for any allowed cutover", () => {
  const historical = ["2026-08-15T12:19:29.000Z", "2026-10-04T13:03:39.000Z", "2026-10-13T14:56:55.000Z", "2026-10-13T14:57:35.233Z"];
  for (const cutoverIso of ["2026-10-13T14:57:36Z", "2026-10-14T00:00:00Z", "2026-12-01T09:00:00Z"]) {
    const cutover = parseCashRefundDebtCutover(cutoverIso);
    for (const iso of historical) {
      assert.equal(creditNoteReducesDebt({ refundMethod: "CASH", validatedAt: new Date(iso) }, cutover), true, `${iso} vs ${cutoverIso}`);
    }
  }
});

test("the business example: 500 DH owed, 100 DH refunded in cash after the cutover - the debt stays 500; an account credit brings it to 400", () => {
  const debtAfter = (notes: Array<{ refundMethod: "CASH" | "BANK"; validatedAt: Date | null; totalTTC: number }>, cutover: Date | null) =>
    Math.max(0, 500 - notes.filter((note) => creditNoteReducesDebt(note, cutover)).reduce((sum, note) => sum + note.totalTTC, 0));
  assert.equal(debtAfter([{ refundMethod: "CASH", validatedAt: at(5), totalTTC: 100 }], T), 500);
  assert.equal(debtAfter([{ refundMethod: "BANK", validatedAt: at(5), totalTTC: 100 }], T), 400);
  assert.equal(debtAfter([{ refundMethod: "CASH", validatedAt: at(-5), totalTTC: 100 }], T), 400, "the same cash refund validated before: historical");
  assert.equal(debtAfter([{ refundMethod: "CASH", validatedAt: at(5), totalTTC: 100 }], null), 400, "dormant: as today");
});

test("one source: the two debt computations build their credit-note filter from this module and nothing else", () => {
  const debt = readFileSync(new URL("./server/customer-debt.ts", import.meta.url), "utf8");
  const core = readFileSync(new URL("./server/receivables-core.ts", import.meta.url), "utf8");
  for (const [name, source] of [["customer-debt.ts", debt], ["receivables-core.ts", core]] as const) {
    assert.match(source, /from "@\/lib\/credit-note-debt-rule"/, name);
    assert.match(source, /debtReducingCreditNoteWhere\(/, name);
    assert.match(source, /cashRefundNotDeductedWhere\(/, name);
    assert.equal(/validatedAt: \{ (lt|gte):/.test(source), false, `${name} does not hand-write a date condition`);
  }
  // the supplier notes and the other statuses stay out of both computations
  assert.match(debt, /partyType: "CUSTOMER",\s*status: "VALIDATED",\s*\.\.\.debtReducingCreditNoteWhere\(cutover\)/);
});
