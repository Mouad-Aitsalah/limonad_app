import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CREDIT_NOTE_LIST_STATUS,
  CREDIT_NOTE_PAYMENT_LABEL,
  CREDIT_NOTE_PAYMENT_METHOD,
  CREDIT_NOTE_REVERSED_LIST_STATUS,
  buildCreditNoteListWhere,
  creditNotePageWindow,
  creditNotesBelongTo,
  isRefundPaymentFilter,
  mapCreditNoteToListItemDto,
  mergeInvoiceAndCreditNoteRows,
  type CreditNoteListRow,
} from "@/lib/credit-note-list-rows";
import { buildOrdersWhere } from "@/lib/sales-orders-where";
import { dailyFiltersFromQuery } from "@/lib/daily-invoices-filters";
import type { SaleHistoryListItemDto } from "@/types/operations-dto";

const row = (overrides: Partial<CreditNoteListRow> = {}): CreditNoteListRow => ({
  id: "cn-1",
  creditNoteNumber: "AV-2026-0001",
  partyType: "CUSTOMER",
  status: "VALIDATED",
  totalTTC: 120,
  validatedAt: new Date("2026-10-15T10:00:00.000Z"),
  createdAt: new Date("2026-10-15T09:59:00.000Z"),
  updatedAt: new Date("2026-10-15T10:00:01.000Z"),
  customer: { id: "c1", code: "3421", name: "Client Test" },
  supplier: null,
  createdBy: { fullName: "Caissier" },
  validatedBy: { fullName: "Caissier" },
  lines: [{ quantity: 2 }, { quantity: 3 }],
  ...overrides,
});

const sale = (id: string, createdAt: string): SaleHistoryListItemDto =>
  ({ id, createdAt, invoiceNumber: id }) as unknown as SaleHistoryListItemDto;

test("a customer credit note is listed with payment « Rembourser », a negative amount and the cash refunded", () => {
  const item = mapCreditNoteToListItemDto(row());
  assert.equal(CREDIT_NOTE_PAYMENT_LABEL, "Rembourser");
  assert.equal(item.paymentMethod, CREDIT_NOTE_PAYMENT_METHOD);
  assert.equal(item.kind, "CREDIT_NOTE");
  assert.equal(item.partyType, "client");
  assert.equal(item.status, CREDIT_NOTE_LIST_STATUS);
  assert.equal(item.invoiceNumber, "AV-2026-0001");
  assert.equal(item.totalTTC, -120);
  assert.equal(item.net, -120);
  assert.equal(item.paidAmount, -120, "the money that left the till");
  assert.equal(item.creditAmount, 0);
  assert.equal(item.articleCount, 5);
  assert.equal(item.customer?.name, "Client Test");
  assert.equal(item.createdAt, "2026-10-15T10:00:00.000Z", "dated by its validation");
});

test("a supplier credit note moves no cash and a reversed one is flagged", () => {
  const supplier = mapCreditNoteToListItemDto(
    row({ partyType: "SUPPLIER", customer: null, supplier: { id: "s1", code: "F1", name: "Fournisseur" } }),
  );
  assert.equal(supplier.partyType, "fournisseur");
  assert.equal(supplier.paidAmount, 0);
  assert.equal(supplier.customer?.name, "Fournisseur");
  assert.equal(mapCreditNoteToListItemDto(row({ status: "REVERSED" })).status, CREDIT_NOTE_REVERSED_LIST_STATUS);
});

test("credit notes belong to « all payments » and « Rembourser » only, never to a POS session", () => {
  assert.equal(creditNotesBelongTo({}), true);
  assert.equal(creditNotesBelongTo({ paymentMethod: "all" }), true);
  assert.equal(creditNotesBelongTo({ paymentMethod: "REFUND" }), true);
  assert.equal(creditNotesBelongTo({ paymentMethod: "CASH" }), false);
  assert.equal(creditNotesBelongTo({ paymentMethod: "all", posSessionId: "s1" }), false);
  assert.equal(isRefundPaymentFilter("REFUND"), true);
  assert.equal(isRefundPaymentFilter("CASH"), false);
});

test("the « Rembourser » filter never reaches the Sale query", () => {
  const where = buildOrdersWhere("org", { paymentMethod: "REFUND" });
  assert.equal("paymentMethod" in where, false);
  assert.equal(buildOrdersWhere("org", { paymentMethod: "CASH" }).paymentMethod, "CASH");
  assert.equal(dailyFiltersFromQuery({ paymentMethod: "REFUND" }, "2026-10-15").paymentMethod, "REFUND");
  assert.equal(dailyFiltersFromQuery({ paymentMethod: "NOPE" }, "2026-10-15").paymentMethod, "all");
});

test("only validated or reversed notes of the organisation are listed, never drafts", () => {
  const where = buildCreditNoteListWhere("org-1", {});
  assert.equal(where.organizationId, "org-1");
  assert.deepEqual(where.status, { in: ["VALIDATED", "REVERSED"] });
});

test("the day range, search and users narrow the credit notes like the sales", () => {
  const start = new Date("2026-10-15T01:00:00.000Z");
  const end = new Date("2026-10-16T01:00:00.000Z");
  const where = buildCreditNoteListWhere("org", { range: { start, end }, userIds: [" u1 ", "u1", ""], search: " AV-1 " });
  const and = JSON.stringify(where.AND);
  assert.match(and, /"gte":"2026-10-15T01:00:00.000Z"/);
  assert.match(and, /"lt":"2026-10-16T01:00:00.000Z"/);
  assert.match(and, /"createdByUserId":\{"in":\["u1"\]\}/);
  assert.match(and, /AV-1/);
});

test("page windows partition the timeline: a credit note appears on exactly one page", () => {
  const s = (iso: string) => ({ createdAt: new Date(iso) });
  const page1 = creditNotePageWindow({ cursorSaleCreatedAt: null, pageRows: [s("2026-10-15T12:00:00Z"), s("2026-10-15T11:00:00Z")], hasMore: true });
  const page2 = creditNotePageWindow({
    cursorSaleCreatedAt: new Date("2026-10-15T11:00:00Z"),
    pageRows: [s("2026-10-15T10:00:00Z"), s("2026-10-15T09:00:00Z")],
    hasMore: true,
  });
  const page3 = creditNotePageWindow({ cursorSaleCreatedAt: new Date("2026-10-15T09:00:00Z"), pageRows: [s("2026-10-15T08:00:00Z")], hasMore: false });
  const windows = [page1, page2, page3];
  const covers = (w: { upper: Date | null; lower: Date | null }, at: Date) =>
    (!w.upper || at < w.upper) && (!w.lower || at >= w.lower);
  for (const iso of ["2026-10-15T13:00:00Z", "2026-10-15T11:00:00Z", "2026-10-15T10:30:00Z", "2026-10-15T09:00:00Z", "2026-10-15T07:00:00Z"]) {
    const hits = windows.filter((w) => covers(w, new Date(iso))).length;
    assert.equal(hits, 1, `${iso} is shown on exactly one page`);
  }
  assert.equal(page1.upper, null, "the first page starts at the top");
  assert.equal(page3.lower, null, "the last page goes down to the oldest");
});

test("invoices and credit notes are merged newest first and nothing is added up", () => {
  const credit = mapCreditNoteToListItemDto(row());
  const merged = mergeInvoiceAndCreditNoteRows(
    [sale("s-new", "2026-10-15T11:00:00.000Z"), sale("s-old", "2026-10-15T09:00:00.000Z")],
    [credit],
  );
  assert.deepEqual(merged.map((item) => item.id), ["s-new", "cn-1", "s-old"]);
  const invoices = [sale("s1", "2026-10-15T11:00:00.000Z")];
  assert.equal(mergeInvoiceAndCreditNoteRows(invoices, []), invoices, "no credit note: the invoice rows are returned as is");
});
