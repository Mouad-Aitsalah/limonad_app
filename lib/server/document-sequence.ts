import "server-only";

import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Phase 3 - numbering scalability chantier.
 *
 * Central, atomic, O(1) counter used by every business-document numbering
 * generator in lib/server (StockMovement, Customer, Sale, POS session,
 * Invoice, Payment, Purchase, CreditNote, Inventory, TruckLoading, Tour,
 * CashDeposit, EmployeeTransaction, AccountingEntry, Category, Driver
 * employee codes, Supplier/ExpenseAccount/TreasuryAccount codes - see the
 * chantier's final report for the full inventory of callers).
 *
 * Each generator keeps its own exact external format (prefix, padding,
 * separators) unchanged - this primitive only replaces the *counting*
 * step (previously count()/findFirst-orderBy-desc/findMany+Math.max, all
 * O(n) and, outside an explicit Serializable transaction, racy) with a
 * single atomic round trip.
 *
 * `documentType` identifies which business document is being numbered
 * (see the DocumentType map below - always use one of these constants,
 * never a raw string, so every caller shares the exact same key).
 *
 * `scopeKey` carries whatever sub-scope that number format already used -
 * a calendar day ("20260830"), a year ("2026"), a payroll month
 * ("202608") - or "" (the default) when the format has no sub-scope
 * beyond the organization. The SAME counter is never shared across two
 * different sub-scopes, exactly like the bespoke per-type logic this
 * replaces - a new (organizationId, documentType, scopeKey) triple simply
 * starts its own row at 1.
 *
 * Reservation is one atomic
 * `INSERT ... ON CONFLICT (...) DO UPDATE ... RETURNING "currentValue"`.
 * This is safe under concurrent callers under Postgres's default Read
 * Committed isolation - no Serializable transaction and no app-level
 * retry is needed for the numbering step itself, and it costs a single
 * indexed upsert regardless of how many documents already exist for that
 * (organization, type, scope): true O(1).
 *
 * Rollback behaviour depends on how `tx` is passed in (verified by
 * scripts/_tmp-test-concurrency.ts, see the chantier report):
 *  - Passed the caller's OWN `tx` (Prisma.TransactionClient) - the normal
 *    case for every generator here except nextExpenseAccountCode/
 *    nextTreasuryAccountCode - this INSERT participates in that same
 *    transaction. If the caller's transaction rolls back, the increment
 *    rolls back with it: the number is simply reused by the next
 *    successful attempt, no gap, exactly like any other write in that
 *    transaction. No number is ever "spent" by a failed business
 *    operation.
 *  - Passed the bare top-level `prisma` client (no surrounding
 *    transaction) - this INSERT commits immediately and independently.
 *    If the caller's own later step then fails, that number is never
 *    reused: a real, permanent gap, exactly like a native Postgres
 *    SEQUENCE. This only affects nextExpenseAccountCode and
 *    nextTreasuryAccountCode today (unchanged from their pre-existing
 *    behaviour - they already generated the code outside any transaction
 *    before this chantier).
 * Either way: no number is ever duplicated or reused by two different
 * documents - only whether a failed attempt leaves a gap differs, and
 * that was already the pre-existing behaviour of the generator it
 * replaces in both cases, so no business rule silently changed.
 */
export async function reserveDocumentSequence(
  tx: Pick<typeof prisma, "$queryRaw">,
  organizationId: string,
  documentType: string,
  scopeKey: string = "",
): Promise<number> {
  const rows = await tx.$queryRaw<{ currentValue: number }[]>(Prisma.sql`
    INSERT INTO "DocumentSequence" ("id", "organizationId", "documentType", "scopeKey", "currentValue", "updatedAt")
    VALUES (md5(random()::text || clock_timestamp()::text), ${organizationId}, ${documentType}, ${scopeKey}, 1, NOW())
    ON CONFLICT ("organizationId", "documentType", "scopeKey")
    DO UPDATE SET "currentValue" = "DocumentSequence"."currentValue" + 1, "updatedAt" = NOW()
    RETURNING "currentValue"
  `);
  return Number(rows[0].currentValue);
}

/** Canonical documentType keys - keep in sync with the backfill script and the report's generator inventory. */
export const DocumentType = {
  StockMovement: "STOCK_MOVEMENT", // sales-shared.ts nextMovementNumber (MV-000123, global per org)
  StockMovementDated: "STOCK_MOVEMENT_DATED", // credit-notes.ts nextMovementNumber (MV-YYYYMMDD-000002, per day)
  CustomerCode: "CUSTOMER_CODE", // customers.ts nextCustomerCode (3421N, global per org)
  Sale: "SALE", // sales-shared.ts resolveSaleSequencing saleNumber (N/YYYY, per year)
  PosSession: "POS_SESSION", // sales-shared.ts resolveSaleSequencing posSession.number (global per org)
  Invoice: "INVOICE", // sales-shared.ts nextInvoiceNumber (VC-YYYYMMDD-SCOPE-000001, per day+scope)
  SalePendingRef: "SALE_PENDING_REF", // sales-shared.ts nextPendingSaleRef - throwaway provisional ref for a not-yet-collected sale (BR-YYYYMMDD-000001, per day). Gaps here are meaningless; the official Invoice/Sale sequences are only consumed at collection.
  Payment: "PAYMENT", // sales-shared.ts nextPaymentNumber (PAY-000001, global per org)
  AccountingEntry: "ACCOUNTING_ENTRY", // accounting.ts nextAccountingEntryNumber (EC-<date>-000001, per day)
  AccountingEntryDraft: "ACCOUNTING_ENTRY_DRAFT", // accounting.ts nextDraftEntryNumber - provisional ref for a not-yet-validated manual entry (BR-<date>-000001, per day). Gaps here are meaningless; the official EC- number is only reserved when the draft is validated.
  SupplierCode: "SUPPLIER_CODE", // business-accounts.ts nextSupplierCode
  ExpenseAccountCode: "EXPENSE_ACCOUNT_CODE", // business-accounts.ts nextExpenseAccountCode (CHG-0001, global per org)
  TreasuryAccountCode: "TREASURY_ACCOUNT_CODE", // business-accounts.ts nextTreasuryAccountCode (TRE-0001, global per org)
  CashDeposit: "CASH_DEPOSIT", // cash-deposits.ts nextDepositNumber (VER-<date>-000001, per day)
  CategoryCode: "CATEGORY_CODE", // categories.ts nextCategoryCode (CAT-001, global per org)
  CreditNoteClient: "CREDIT_NOTE_CLIENT", // credit-notes.ts nextCreditNoteNumber partyType=customer (AC-<date>-000001, per day)
  CreditNoteSupplier: "CREDIT_NOTE_SUPPLIER", // credit-notes.ts nextCreditNoteNumber partyType=supplier (AF-<date>-000001, per day)
  EmployeeTransaction: "EMPLOYEE_TRANSACTION", // employee-transactions.ts nextTransactionNumber (SAL-YYYYMM-000001, per payroll month)
  Purchase: "PURCHASE", // purchases.ts nextPurchaseNumber (A-000001, global per org)
  TourCode: "TOUR_CODE", // tours.ts nextTourCode (TOUR-YYYYMMDD-001, per day)
  LoadingSequence: "LOADING_SEQUENCE", // truck-loadings.ts nextLoadingSequence (per year)
  LoadingNumber: "LOADING_NUMBER", // truck-loadings.ts nextLoadingNumber (CHG-000001, global per org)
  DriverEmployeeCode: "DRIVER_EMPLOYEE_CODE", // users.ts nextDriverEmployeeCode (DRV-0001, global per org)
  Inventory: "INVENTORY", // inventories.ts inline count()+1 (INV-0001, global per org)
  DepotCode: "DEPOT_CODE", // depots.ts provisionDepot (DEP-001, global per org; the linked StockLocation reuses it as SL-DEP-001)
  // BI Phase 2A. NOTE: "CHG-" was NOT reused for Expense - it already means
  // two different things in this codebase (ExpenseAccountCode's CHG-0001
  // above, and TruckLoading's CHG/N/YYYY / CHG-000001 numbering) - a third
  // meaning would make the same visible prefix ambiguous across screens.
  ExpenseNumber: "EXPENSE_NUMBER", // expenses.ts nextExpenseNumber (DPN-000001, global per org)
  CustomerSettlementNumber: "CUSTOMER_SETTLEMENT_NUMBER", // customer-settlements.ts nextSettlementNumber (REGL-000001, global per org)
} as const;
