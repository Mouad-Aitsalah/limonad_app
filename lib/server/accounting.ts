import "server-only";

import { z } from "zod";

import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  accountingSystemAccountCodes,
  defaultAccountingAccounts,
  defaultAccountingSettingsByCode,
} from "@/lib/accounting";
import { MONEY_RANGE_MAX_NUMBER } from "@/lib/money";
import { getCurrentSessionUser, requireSessionUser } from "@/lib/server/auth";
import { assertMoneyRange, OperationsServiceError } from "@/lib/server/depots";
import { DocumentType, reserveDocumentSequence } from "@/lib/server/document-sequence";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import type {
  AccountingAccountDto,
  AccountingAccountInput,
  AccountingAccountOptionDto,
  AccountingAccountSettingsKey,
  AccountingAccountType,
  AccountingEntryDto,
  AccountingJournalLineDto,
  AccountingJournalType,
  AccountingSettingsDto,
  AccountingSettingsUpdateInput,
  AccountingSourceType,
  AccountingStampCalculationMethod,
  ManualAccountingEntryInput,
} from "@/types/accounting";

const accountTypeValues = [
  "ASSET",
  "LIABILITY",
  "EQUITY",
  "REVENUE",
  "EXPENSE",
  "TREASURY",
  "RECEIVABLE",
  "PAYABLE",
  "TAX",
] as const;

const journalTypeValues = [
  "GENERAL",
  "SALES",
  "PURCHASES",
  "TREASURY",
  "CREDIT_NOTES",
  "MANUAL",
] as const;

const settingsKeys = Object.keys(
  defaultAccountingSettingsByCode,
) as AccountingAccountSettingsKey[];

const accountInputSchema = z.object({
  code: z.string().trim().min(1, "Le code du compte est obligatoire.").max(24),
  name: z.string().trim().min(1, "Le nom du compte est obligatoire.").max(120),
  type: z.enum(accountTypeValues),
  isActive: z.boolean().optional(),
});

const settingsUpdateSchema = z.object({
  employeePayrollExpenseAccountId: z.string().trim().nullable().optional(),
  salesAccountId: z.string().trim().nullable().optional(),
  salesVatAccountId: z.string().trim().nullable().optional(),
  purchaseAccountId: z.string().trim().nullable().optional(),
  purchaseVatAccountId: z.string().trim().nullable().optional(),
  cashAccountId: z.string().trim().nullable().optional(),
  bankAccountId: z.string().trim().nullable().optional(),
  customerAccountId: z.string().trim().nullable().optional(),
  supplierAccountId: z.string().trim().nullable().optional(),
  customerReturnAccountId: z.string().trim().nullable().optional(),
  supplierReturnAccountId: z.string().trim().nullable().optional(),
  stampEnabled: z.boolean().optional(),
  stampCalculationMethod: z
    .enum(["FIXED_AMOUNT", "PERCENTAGE_OF_TOTAL_TTC"] satisfies [
      AccountingStampCalculationMethod,
      ...AccountingStampCalculationMethod[],
    ])
    .optional(),
  // F8-F: input-level sanity bound only - see the server-side
  // assertMoneyRange call in updateAccountingSettings below.
  stampValue: z.coerce.number().min(0).max(MONEY_RANGE_MAX_NUMBER).optional(),
  stampExpenseAccountId: z.string().trim().nullable().optional(),
  stampPayableAccountId: z.string().trim().nullable().optional(),
});

const manualEntrySchema = z.object({
  date: z.string().trim().min(1, "La date est obligatoire."),
  reference: z.string().trim().nullable().optional(),
  description: z.string().trim().min(1, "La description est obligatoire."),
  journalType: z.enum(journalTypeValues).optional(),
  lines: z
    .array(
      z.object({
        accountId: z.string().trim().min(1, "Le compte est obligatoire."),
        label: z.string().trim().min(1, "Le libelle est obligatoire."),
        debit: z.union([z.number(), z.string()]),
        credit: z.union([z.number(), z.string()]),
      }),
    )
    .min(2, "Ajoutez au moins deux lignes."),
});

type DbClient = typeof prisma | Prisma.TransactionClient;

type DecimalInput = Prisma.Decimal | number | string;

type NormalizedEntryLine = {
  accountId: string;
  label: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  position: number;
};

type CreatePostedEntryInput = {
  organizationId?: string;
  date: Date;
  reference?: string | null;
  description: string;
  journalType: AccountingJournalType;
  sourceType?: AccountingSourceType | null;
  sourceId?: string | null;
  createdByUserId?: string | null;
  lines: Array<{
    accountId: string;
    label: string;
    debit: DecimalInput;
    credit: DecimalInput;
  }>;
};

type SaleAccountingPayload = {
  organizationId?: string;
  saleId: string;
  invoiceNumber: string;
  customerId?: string | null;
  date: Date;
  subtotalHT: DecimalInput;
  taxAmount: DecimalInput;
  totalTTC: DecimalInput;
  stampAmount?: DecimalInput;
  paidAmount: DecimalInput;
  creditAmount: DecimalInput;
  paymentMethod: string;
  paymentId?: string | null;
  paymentReference?: string | null;
  createdByUserId: string;
};

type PurchaseAccountingPayload = {
  organizationId?: string;
  purchaseId: string;
  purchaseNumber: string;
  supplierId: string;
  date: Date;
  subtotalHT: DecimalInput;
  taxAmount: DecimalInput;
  totalTTC: DecimalInput;
  paymentMethod: string;
  createdByUserId: string;
};

type CreditNoteAccountingPayload = {
  organizationId?: string;
  creditNoteId: string;
  creditNoteNumber: string;
  partyType: "CUSTOMER" | "SUPPLIER";
  refundMethod: "CASH" | "BANK";
  date: Date;
  subtotalHT: DecimalInput;
  taxAmount: DecimalInput;
  totalTTC: DecimalInput;
  createdByUserId: string;
};

type ReverseAccountingEntryPayload = {
  organizationId?: string;
  sourceType: AccountingSourceType;
  sourceId: string;
  date: Date;
  reference?: string | null;
  description?: string | null;
  createdByUserId: string;
};

type EmployeePayrollAccountingPayload = {
  organizationId?: string;
  operationId: string;
  operationNumber: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  date: Date;
  payrollYear: number;
  payrollMonth: number;
  type: "ADVANCE" | "REMUNERATION_PERSONNEL" | "TRANSFER";
  amount: DecimalInput;
  salary: DecimalInput;
  advanceTotal: DecimalInput;
  advanceToOffset: DecimalInput;
  remainingSalary: DecimalInput;
  advanceAccountId: string | null;
  salaryAccountId: string | null;
  createdByUserId: string;
};

const entryInclude = {
  createdBy: { select: { id: true, fullName: true } },
  reversalEntry: { select: { id: true } },
  lines: {
    include: {
      account: { select: { id: true, code: true, name: true } },
    },
    orderBy: [{ position: "asc" as const }, { operationNumber: "asc" as const }],
  },
};

const settingsInclude = {
  updatedBy: { select: { id: true, fullName: true } },
} as const;

export async function listAccountingAccounts(): Promise<AccountingAccountDto[]> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  await ensureAccountingBootstrap(prisma, currentUser.organizationId);

  const accounts = await prisma.accountingAccount.findMany({
    where: { organizationId: currentUser.organizationId },
    include: {
      _count: { select: { lines: true } },
    },
    orderBy: [{ code: "asc" }],
  });

  return accounts.map((account) => ({
    id: account.id,
    code: account.code,
    name: account.name,
    type: account.type,
    isActive: account.isActive,
    movementCount: account._count.lines,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  }));
}

export async function listAccountingAccountOptions(): Promise<AccountingAccountOptionDto[]> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  await ensureAccountingBootstrap(prisma, currentUser.organizationId);

  const accounts = await prisma.accountingAccount.findMany({
    where: { organizationId: currentUser.organizationId },
    orderBy: [{ code: "asc" }],
  });

  return accounts.map((account) => ({
    id: account.id,
    code: account.code,
    name: account.name,
    type: account.type,
    isActive: account.isActive,
  }));
}

export async function createAccountingAccount(
  input: AccountingAccountInput,
): Promise<AccountingAccountDto> {
  const currentUser = await requireOrganizationUser(["admin"]);
  await ensureAccountingBootstrap(prisma, currentUser.organizationId);

  const parsed = accountInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationsServiceError("Compte comptable invalide.", 422);
  }

  const code = normalizeAccountCode(parsed.data.code);
  const existing = await prisma.accountingAccount.findFirst({
    where: { code, organizationId: currentUser.organizationId },
  });
  if (existing) {
    throw new OperationsServiceError("Ce code de compte existe deja.", 409);
  }

  const account = await prisma.accountingAccount.create({
    data: {
      organizationId: currentUser.organizationId,
      code,
      name: parsed.data.name.trim(),
      type: parsed.data.type,
      isActive: parsed.data.isActive ?? true,
    },
    include: {
      _count: { select: { lines: true } },
    },
  });

  return {
    id: account.id,
    code: account.code,
    name: account.name,
    type: account.type,
    isActive: account.isActive,
    movementCount: account._count.lines,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

export async function updateAccountingAccount(
  id: string,
  input: AccountingAccountInput,
): Promise<AccountingAccountDto> {
  const currentUser = await requireOrganizationUser(["admin"]);
  await ensureAccountingBootstrap(prisma, currentUser.organizationId);

  const parsed = accountInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationsServiceError("Compte comptable invalide.", 422);
  }

  const account = await prisma.accountingAccount.findFirst({
    where: { id, organizationId: currentUser.organizationId },
  });
  if (!account) {
    throw new OperationsServiceError("Compte introuvable.", 404);
  }

  const code = normalizeAccountCode(parsed.data.code);
  const owner = await prisma.accountingAccount.findFirst({
    where: { code, organizationId: currentUser.organizationId },
  });
  if (owner && owner.id !== id) {
    throw new OperationsServiceError("Ce code de compte est deja utilise.", 409);
  }

  const updated = await prisma.accountingAccount.update({
    where: { id },
    data: {
      code,
      name: parsed.data.name.trim(),
      type: parsed.data.type,
      isActive: parsed.data.isActive ?? account.isActive,
    },
    include: {
      _count: { select: { lines: true } },
    },
  });

  return {
    id: updated.id,
    code: updated.code,
    name: updated.name,
    type: updated.type,
    isActive: updated.isActive,
    movementCount: updated._count.lines,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  };
}

export async function setAccountingAccountActive(
  id: string,
  isActive: boolean,
): Promise<AccountingAccountDto> {
  const currentUser = await requireOrganizationUser(["admin"]);
  await ensureAccountingBootstrap(prisma, currentUser.organizationId);

  const account = await prisma.accountingAccount.findFirst({
    where: { id, organizationId: currentUser.organizationId },
    include: { _count: { select: { lines: true } } },
  });
  if (!account) {
    throw new OperationsServiceError("Compte introuvable.", 404);
  }

  const updated = await prisma.accountingAccount.update({
    where: { id },
    data: { isActive },
    include: { _count: { select: { lines: true } } },
  });

  return {
    id: updated.id,
    code: updated.code,
    name: updated.name,
    type: updated.type,
    isActive: updated.isActive,
    movementCount: updated._count.lines,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  };
}

export async function getAccountingSettings(): Promise<AccountingSettingsDto> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  await ensureAccountingBootstrap(prisma, currentUser.organizationId);

  const settings = await prisma.accountingSettings.findUniqueOrThrow({
    where: { organizationId: currentUser.organizationId },
    include: settingsInclude,
  });

  return mapSettingsToDto(settings);
}

export async function updateAccountingSettings(
  input: AccountingSettingsUpdateInput,
): Promise<AccountingSettingsDto> {
  const user = await requireOrganizationUser(["admin"]);
  await ensureAccountingBootstrap(prisma, user.organizationId);

  const parsed = settingsUpdateSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationsServiceError("Parametres comptables invalides.", 422);
  }

  const referencedIds = settingsKeys
    .map((key) => parsed.data[key])
    .filter((value): value is string => Boolean(value));

  if (referencedIds.length > 0) {
    const accounts = await prisma.accountingAccount.findMany({
      where: {
        id: { in: referencedIds },
        organizationId: user.organizationId,
      },
      select: { id: true },
    });
    if (accounts.length !== referencedIds.length) {
      throw new OperationsServiceError("Un compte selectionne est introuvable.", 422);
    }
  }

  // F8-F: AccountingSettings.stampValue is Decimal(12,2), checked before
  // the write below regardless of how small it is in practice.
  if (parsed.data.stampValue !== undefined) {
    assertMoneyRange(parsed.data.stampValue, "stampValue");
  }

  const settings = await prisma.accountingSettings.upsert({
    where: { organizationId: user.organizationId },
    create: {
      organizationId: user.organizationId,
      ...parsed.data,
      updatedByUserId: user.id,
    },
    update: {
      ...parsed.data,
      updatedByUserId: user.id,
    },
    include: settingsInclude,
  });

  return mapSettingsToDto(settings);
}

export async function computeCashSaleStampAmount(
  db: DbClient,
  input: {
    organizationId?: string;
    totalTTC: DecimalInput;
    paymentMethod: string;
  },
) {
  const organizationId = await resolveOrganizationId({
    explicitOrganizationId: input.organizationId,
  });
  await ensureAccountingBootstrap(db, organizationId);
  if (input.paymentMethod !== "CASH") {
    return toMoneyDecimal(0);
  }
  const totalTTC = toMoneyDecimal(input.totalTTC);
  return totalTTC.mul("0.0025").toDecimalPlaces(2);
}

export async function listAccountingEntries(): Promise<AccountingEntryDto[]> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  await ensureAccountingBootstrap(prisma, currentUser.organizationId);

  const entries = await prisma.accountingEntry.findMany({
    where: { organizationId: currentUser.organizationId },
    include: entryInclude,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }, { entryNumber: "desc" }],
  });

  return entries.map(mapEntryToDto);
}

export async function listAccountingJournalLines(): Promise<AccountingJournalLineDto[]> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const entries = await listAccountingEntries();
  const metadata = await buildJournalMetadata(
    prisma,
    currentUser.organizationId,
    entries,
  );
  const sortedEntries = [...entries].sort((left, right) =>
    compareJournalEntries(left, right, metadata),
  );

  return sortedEntries
    .flatMap((entry) =>
      entry.lines.map((line) => {
      const meta = metadata.get(`${entry.sourceType ?? "none"}:${entry.sourceId ?? "none"}`) ?? null;

      return {
        id: line.id,
        entryId: entry.id,
        entryNumber: entry.entryNumber,
        operationNumber: line.operationNumber,
        date: entry.date,
        reference: entry.reference,
        description: entry.description,
        journalType: entry.journalType,
        status: entry.status,
        sourceType: entry.sourceType,
        sourceId: entry.sourceId,
        createdByUserName: entry.createdByUserName,
        accountId: line.accountId,
        accountCode: line.accountCode,
        accountName: line.accountName,
        label: line.label,
        debit: line.debit,
        credit: line.credit,
        position: line.position,
        invoiceNumber: meta?.invoiceNumber ?? entry.reference,
        checkNumber: meta?.checkNumber ?? null,
        partyName: meta?.partyName ?? null,
      };
      }),
    )
    .sort(compareJournalLines);
}

function compareJournalLines(
  left: AccountingJournalLineDto,
  right: AccountingJournalLineDto,
) {
  const dateCompare = right.date.localeCompare(left.date);
  if (dateCompare !== 0) return dateCompare;

  const operationCompare = right.operationNumber - left.operationNumber;
  if (operationCompare !== 0) return operationCompare;

  return left.position - right.position;
}

export async function createManualAccountingEntry(
  input: ManualAccountingEntryInput,
): Promise<AccountingEntryDto> {
  const user = await requireOrganizationUser(["admin"]);
  await ensureAccountingBootstrap(prisma, user.organizationId);

  const parsed = manualEntrySchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationsServiceError("Ecriture comptable invalide.", 422);
  }

  const entryDate = parseAccountingDate(parsed.data.date);
  const normalizedLines = normalizeEntryLines(parsed.data.lines);
  assertBalancedEntry(normalizedLines);

  await assertAccountsExist(
    prisma,
    user.organizationId,
    normalizedLines.map((line) => line.accountId),
  );

  const entry = await createPostedEntry(prisma, {
    organizationId: user.organizationId,
    date: entryDate,
    reference: parsed.data.reference?.trim() || null,
    description: parsed.data.description.trim(),
    journalType: parsed.data.journalType ?? "MANUAL",
    sourceType: "MANUAL_ENTRY",
    createdByUserId: user.id,
    lines: normalizedLines.map((line) => ({
      accountId: line.accountId,
      label: line.label,
      debit: line.debit,
      credit: line.credit,
    })),
  });

  return mapEntryToDto(entry);
}

export async function postSaleAccountingEntry(
  db: Prisma.TransactionClient,
  payload: SaleAccountingPayload,
) {
  const organizationId = await resolveOrganizationId({
    explicitOrganizationId: payload.organizationId,
    createdByUserId: payload.createdByUserId,
    saleId: payload.saleId,
  });
  await ensureAccountingBootstrap(db, organizationId);

  const settings = await requireSettings(db, organizationId, [
    "salesAccountId",
    "salesVatAccountId",
    "cashAccountId",
    "bankAccountId",
    "customerAccountId",
  ]);

  const customerAccountId = await resolveCustomerAuxiliaryAccountId(
    db,
    organizationId,
    payload.customerId ?? null,
    settings.customerAccountId,
  );
  const stampExpenseAccountId = await requireSystemAccountIdByCode(
    db,
    organizationId,
    accountingSystemAccountCodes.stampExpense,
  );
  const stampTaxPayableAccountId = await requireSystemAccountIdByCode(
    db,
    organizationId,
    accountingSystemAccountCodes.stampTaxPayable,
  );
  const paidAmount = toMoneyDecimal(payload.paidAmount);
  const subtotalHT = toMoneyDecimal(payload.subtotalHT);
  const taxAmount = toMoneyDecimal(payload.taxAmount);
  const stampAmount = toMoneyDecimal(payload.stampAmount ?? 0);

  const invoiceEntry =
    (await db.accountingEntry.findFirst({
      where: {
        organizationId,
        sourceType: "SALE",
        sourceId: payload.saleId,
      },
      include: entryInclude,
    })) ??
    (await createPostedEntry(db, {
      organizationId,
      date: payload.date,
      reference: payload.invoiceNumber,
      description: `Facture vente ${payload.invoiceNumber}`,
      journalType: "SALES",
      sourceType: "SALE",
      sourceId: payload.saleId,
      createdByUserId: payload.createdByUserId,
      lines: [
        {
          accountId: customerAccountId,
          label: buildSaleInvoiceCustomerLabel(payload.invoiceNumber),
          debit: toMoneyDecimal(payload.totalTTC),
          credit: 0,
        },
        ...(stampAmount.gt(0)
          ? [
              {
                accountId: stampExpenseAccountId,
                label: buildSaleStampExpenseLabel(payload.invoiceNumber),
                debit: stampAmount,
                credit: 0,
              },
            ]
          : []),
        {
          accountId: settings.salesAccountId,
          label: buildSaleRevenueLabel(),
          debit: 0,
          credit: subtotalHT,
        },
        // F8 fix #1: a line with debit=0 AND credit=0 (a 0%-VAT sale) is
        // rejected by assertBalancedEntry ("either a debit or a credit",
        // never neither) - omit the VAT line entirely when there is no VAT
        // to post, same guard already used for stampAmount just below.
        ...(taxAmount.gt(0)
          ? [
              {
                accountId: settings.salesVatAccountId,
                label: buildSaleVatLabel(),
                debit: 0,
                credit: taxAmount,
              },
            ]
          : []),
        ...(stampAmount.gt(0)
          ? [
              {
                accountId: stampTaxPayableAccountId,
                label: buildSaleStampPayableLabel(),
                debit: 0,
                credit: stampAmount,
              },
            ]
          : []),
      ],
    }));

  if (
    paidAmount.lte(0) ||
    payload.paymentMethod === "CREDIT" ||
    !payload.paymentId
  ) {
    return invoiceEntry;
  }

  const settlementSourceId = payload.paymentId;
  const existingSettlement = await db.accountingEntry.findFirst({
    where: {
      organizationId,
      sourceType: "CUSTOMER_PAYMENT",
      sourceId: settlementSourceId,
    },
    include: entryInclude,
  });
  if (existingSettlement) {
    return invoiceEntry;
  }

  const treasuryAccountId = usesBankAccount(payload.paymentMethod)
    ? settings.bankAccountId
    : settings.cashAccountId;

  await createPostedEntry(db, {
    organizationId,
    date: payload.date,
    reference: payload.invoiceNumber,
    description: `Reglement facture ${payload.invoiceNumber}`,
    journalType: "TREASURY",
    sourceType: "CUSTOMER_PAYMENT",
    sourceId: settlementSourceId,
    createdByUserId: payload.createdByUserId,
    lines: [
      {
        accountId: treasuryAccountId,
        label: buildSaleSettlementLabel(),
        debit: paidAmount,
        credit: 0,
      },
      {
        accountId: customerAccountId,
        label: buildSaleSettlementLabel(),
        debit: 0,
        credit: paidAmount,
      },
    ],
  });

  return invoiceEntry;
}

export async function postPurchaseAccountingEntry(
  db: Prisma.TransactionClient,
  payload: PurchaseAccountingPayload,
) {
  const organizationId = await resolveOrganizationId({
    explicitOrganizationId: payload.organizationId,
    createdByUserId: payload.createdByUserId,
    purchaseId: payload.purchaseId,
  });
  await ensureAccountingBootstrap(db, organizationId);

  const settings = await requireSettings(db, organizationId, [
    "purchaseAccountId",
    "purchaseVatAccountId",
    "supplierAccountId",
    "cashAccountId",
    "bankAccountId",
  ]);

  const supplierAccountId = await resolveSupplierAuxiliaryAccountId(
    db,
    organizationId,
    payload.supplierId,
    settings.supplierAccountId,
  );
  const subtotalHT = toMoneyDecimal(payload.subtotalHT);
  const taxAmount = toMoneyDecimal(payload.taxAmount);
  const totalTTC = toMoneyDecimal(payload.totalTTC);

  const invoiceEntry =
    (await db.accountingEntry.findFirst({
      where: {
        organizationId,
        sourceType: "PURCHASE",
        sourceId: payload.purchaseId,
      },
      include: entryInclude,
    })) ??
    (await createPostedEntry(db, {
      organizationId,
      date: payload.date,
      reference: payload.purchaseNumber,
      description: `Facture achat ${payload.purchaseNumber}`,
      journalType: "PURCHASES",
      sourceType: "PURCHASE",
      sourceId: payload.purchaseId,
      createdByUserId: payload.createdByUserId,
      lines: [
        {
          accountId: settings.purchaseAccountId,
          label: buildPurchaseExpenseLabel(),
          debit: subtotalHT,
          credit: 0,
        },
        // F8 fix #1: same guard as postSaleAccountingEntry - omit the VAT
        // line entirely for a 0%-VAT purchase, rather than posting a
        // debit=0/credit=0 line that assertBalancedEntry would reject.
        ...(taxAmount.gt(0)
          ? [
              {
                accountId: settings.purchaseVatAccountId,
                label: buildPurchaseVatLabel(),
                debit: taxAmount,
                credit: 0,
              },
            ]
          : []),
        {
          accountId: supplierAccountId,
          label: buildPurchaseSupplierLabel(payload.purchaseNumber),
          debit: 0,
          credit: totalTTC,
        },
      ],
    }));

  if (payload.paymentMethod === "credit_fournisseur") {
    return invoiceEntry;
  }

  const settlementSourceId = `${payload.purchaseId}:settlement`;
  const existingSettlement = await db.accountingEntry.findFirst({
    where: {
      organizationId,
      sourceType: "SUPPLIER_PAYMENT",
      sourceId: settlementSourceId,
    },
    include: entryInclude,
  });
  if (existingSettlement) return invoiceEntry;

  const treasuryAccountId = usesPurchaseBankAccount(payload.paymentMethod)
    ? settings.bankAccountId
    : settings.cashAccountId;

  await createPostedEntry(db, {
    organizationId,
    date: payload.date,
    reference: payload.purchaseNumber,
    description: `Reglement achat ${payload.purchaseNumber}`,
    journalType: "TREASURY",
    sourceType: "SUPPLIER_PAYMENT",
    sourceId: settlementSourceId,
    createdByUserId: payload.createdByUserId,
    lines: [
      {
        accountId: supplierAccountId,
        label: buildPurchaseSettlementLabel(),
        debit: totalTTC,
        credit: 0,
      },
      {
        accountId: treasuryAccountId,
        label: buildPurchaseSettlementLabel(),
        debit: 0,
        credit: totalTTC,
      },
    ],
  });

  return invoiceEntry;
}

export async function postValidatedCreditNoteAccountingEntry(
  db: Prisma.TransactionClient,
  payload: CreditNoteAccountingPayload,
) {
  const organizationId = await resolveOrganizationId({
    explicitOrganizationId: payload.organizationId,
    createdByUserId: payload.createdByUserId,
    creditNoteId: payload.creditNoteId,
  });
  await ensureAccountingBootstrap(db, organizationId);

  const sourceType =
    payload.partyType === "SUPPLIER"
      ? "SUPPLIER_CREDIT_NOTE"
      : "CUSTOMER_CREDIT_NOTE";

  const existing = await db.accountingEntry.findFirst({
    where: { organizationId, sourceType, sourceId: payload.creditNoteId },
  });
  if (existing) return existing;

  const subtotalHT = toMoneyDecimal(payload.subtotalHT);
  const taxAmount = toMoneyDecimal(payload.taxAmount);
  const totalTTC = toMoneyDecimal(payload.totalTTC);

  let lines: CreatePostedEntryInput["lines"];
  let description: string;

  if (payload.partyType === "SUPPLIER") {
    if (payload.refundMethod === "CASH") {
      // Cash-settled supplier return: fixed structure requested to match the
      // reference software exactly (4411 / 6111 / 34552) rather than the
      // auxiliary-account / return-account treatment used below.
      const supplierGeneralAccountId = await requireSystemAccountIdByCode(
        db,
        organizationId,
        accountingSystemAccountCodes.supplierGeneral,
      );
      const purchaseAccountId = await requireSystemAccountIdByCode(
        db,
        organizationId,
        accountingSystemAccountCodes.purchase,
      );

      lines = [
        {
          accountId: supplierGeneralAccountId,
          label: "Fournisseurs",
          debit: totalTTC,
          credit: 0,
        },
        {
          accountId: purchaseAccountId,
          label: "Achats de marchandises",
          debit: 0,
          credit: subtotalHT,
        },
      ];

      if (taxAmount.gt(0)) {
        const vatRecoverableAccountId = await requireSystemAccountIdByCode(
          db,
          organizationId,
          accountingSystemAccountCodes.supplierCashCreditNoteVat,
        );
        lines.push({
          accountId: vatRecoverableAccountId,
          label: "Etat - TVA recuperable sur charges",
          debit: 0,
          credit: taxAmount,
        });
      }

      description = `Avoir fournisseur ${payload.creditNoteNumber}`;
    } else {
      const settings = await requireSettings(db, organizationId, [
        "supplierAccountId",
        "supplierReturnAccountId",
        "purchaseVatAccountId",
      ]);

      lines = [
        {
          accountId: settings.supplierAccountId,
          label: `Avoir fournisseur ${payload.creditNoteNumber}`,
          debit: totalTTC,
          credit: 0,
        },
        {
          accountId: settings.supplierReturnAccountId,
          label: `Retour fournisseur ${payload.creditNoteNumber}`,
          debit: 0,
          credit: subtotalHT,
        },
        // F8 fix #1: same guard as the CASH branch just above (which
        // already had it) - omit the VAT line for a 0%-VAT credit note.
        ...(taxAmount.gt(0)
          ? [
              {
                accountId: settings.purchaseVatAccountId,
                label: `TVA avoir fournisseur ${payload.creditNoteNumber}`,
                debit: 0,
                credit: taxAmount,
              },
            ]
          : []),
      ];
      description = `Avoir fournisseur ${payload.creditNoteNumber}`;
    }
  } else {
    if (payload.refundMethod === "CASH") {
      // Cash-refunded customer credit note: fixed 4-line structure requested
      // to match the reference software exactly (7111 / 117 / 117 / 51611),
      // using the gross TTC amount on every line rather than an HT/VAT split.
      const salesAccountId = await requireSystemAccountIdByCode(
        db,
        organizationId,
        accountingSystemAccountCodes.sales,
      );
      const transitAccountId = await requireSystemAccountIdByCode(
        db,
        organizationId,
        accountingSystemAccountCodes.customerCashCreditNoteTransit,
      );
      const cashAccountId = await requireSystemAccountIdByCode(
        db,
        organizationId,
        accountingSystemAccountCodes.cash,
      );

      lines = [
        { accountId: salesAccountId, label: "Avoir Client", debit: totalTTC, credit: 0 },
        { accountId: transitAccountId, label: "Avoir Client", debit: 0, credit: totalTTC },
        { accountId: transitAccountId, label: "Avoir Client", debit: totalTTC, credit: 0 },
        { accountId: cashAccountId, label: "Avoir Client", debit: 0, credit: totalTTC },
      ];
      description = `Avoir Client ${payload.creditNoteNumber}`;
    } else {
      const settings = await requireSettings(db, organizationId, [
        "customerAccountId",
        "customerReturnAccountId",
        "salesVatAccountId",
      ]);

      lines = [
        {
          accountId: settings.customerReturnAccountId,
          label: `Retour client ${payload.creditNoteNumber}`,
          debit: subtotalHT,
          credit: 0,
        },
        // F8 fix #1: same guard as the two branches above - omit the VAT
        // line for a 0%-VAT credit note.
        ...(taxAmount.gt(0)
          ? [
              {
                accountId: settings.salesVatAccountId,
                label: `TVA avoir client ${payload.creditNoteNumber}`,
                debit: taxAmount,
                credit: 0,
              },
            ]
          : []),
        {
          accountId: settings.customerAccountId,
          label: `Client ${payload.creditNoteNumber}`,
          debit: 0,
          credit: totalTTC,
        },
      ];
      description = `Avoir client ${payload.creditNoteNumber}`;
    }
  }

  return createPostedEntry(db, {
    organizationId,
    date: payload.date,
    reference: payload.creditNoteNumber,
    description,
    journalType: "CREDIT_NOTES",
    sourceType,
    sourceId: payload.creditNoteId,
    createdByUserId: payload.createdByUserId,
    lines,
  });
}

export async function reverseAccountingEntryForSource(
  db: Prisma.TransactionClient,
  payload: ReverseAccountingEntryPayload,
) {
  const organizationId = await resolveOrganizationId({
    explicitOrganizationId: payload.organizationId,
    createdByUserId: payload.createdByUserId,
  });
  const original = await db.accountingEntry.findFirst({
    where: {
      organizationId,
      sourceType: payload.sourceType,
      sourceId: payload.sourceId,
    },
    include: entryInclude,
  });

  if (!original) return null;
  if (original.reversalEntry) return original.reversalEntry;

  const reversal = await db.accountingEntry.create({
    data: {
      organizationId,
      entryNumber: await nextAccountingEntryNumber(db, organizationId, payload.date),
      date: payload.date,
      reference: payload.reference ?? original.reference,
      description:
        payload.description?.trim() ||
        `Contre-passation de l'ecriture ${original.entryNumber}`,
      journalType: original.journalType,
      status: "POSTED",
      createdByUserId: payload.createdByUserId,
      reversedEntryId: original.id,
      lines: {
        create: original.lines.map((line) => ({
          accountId: line.accountId,
          label: `Contre-passation ${line.label}`,
          debit: line.credit,
          credit: line.debit,
          position: line.position,
        })),
      },
    },
    include: entryInclude,
  });

  await db.accountingEntry.update({
    where: { id: original.id },
    data: { status: "REVERSED" },
  });

  return reversal;
}

export async function postEmployeePayrollAccountingEntry(
  db: Prisma.TransactionClient,
  payload: EmployeePayrollAccountingPayload,
) {
  const organizationId = await resolveOrganizationId({
    explicitOrganizationId: payload.organizationId,
    createdByUserId: payload.createdByUserId,
    employeeId: payload.employeeId,
  });
  await ensureAccountingBootstrap(db, organizationId);

  const amount = toMoneyDecimal(payload.amount);
  const advanceToOffset = toMoneyDecimal(payload.advanceToOffset);
  const periodLabel = formatPayrollPeriod(payload.payrollYear, payload.payrollMonth);

  switch (payload.type) {
    case "ADVANCE": {
      if (!payload.advanceAccountId) {
        throw new OperationsServiceError(
          "Veuillez configurer les comptes comptables de cet employe.",
          422,
          { advanceAccountId: "Compte avance manquant." },
        );
      }

      const settings = await requireSettings(db, organizationId, ["cashAccountId"]);
      return createPostedEntry(db, {
        organizationId,
        date: payload.date,
        reference: payload.operationNumber,
        description: `Avance au personnel - ${payload.employeeName} - ${periodLabel}`,
        journalType: "TREASURY",
        sourceType: "EMPLOYEE_ADVANCE",
        sourceId: payload.operationId,
        createdByUserId: payload.createdByUserId,
        lines: [
          {
            accountId: payload.advanceAccountId,
            label: buildEmployeeAdvanceLabel(payload.employeeName),
            debit: amount,
            credit: 0,
          },
          {
            accountId: settings.cashAccountId,
            label: buildEmployeeAdvanceCashLabel(payload.employeeName),
            debit: 0,
            credit: amount,
          },
        ],
      });
    }

    case "REMUNERATION_PERSONNEL": {
      if (!payload.salaryAccountId) {
        throw new OperationsServiceError(
          "Veuillez configurer les comptes comptables de cet employe.",
          422,
          { salaryAccountId: "Compte salaire manquant." },
        );
      }

      const settings = await requireSettings(
        db,
        organizationId,
        ["employeePayrollExpenseAccountId"],
      );
      return createPostedEntry(db, {
        organizationId,
        date: payload.date,
        reference: payload.operationNumber,
        description: `Remuneration du personnel - ${payload.employeeName} - ${periodLabel}`,
        journalType: "GENERAL",
        sourceType: "EMPLOYEE_REMUNERATION",
        sourceId: payload.operationId,
        createdByUserId: payload.createdByUserId,
        lines: [
          {
            accountId: settings.employeePayrollExpenseAccountId,
            label: buildEmployeePayrollExpenseLabel(payload.employeeName),
            debit: amount,
            credit: 0,
          },
          {
            accountId: payload.salaryAccountId,
            label: buildEmployeeSalaryDueLabel(payload.employeeName),
            debit: 0,
            credit: amount,
          },
        ],
      });
    }

    case "TRANSFER": {
      if (!payload.salaryAccountId) {
        throw new OperationsServiceError(
          "Veuillez configurer les comptes comptables de cet employe.",
          422,
          { salaryAccountId: "Compte salaire manquant." },
        );
      }
      if (advanceToOffset.gt(0) && !payload.advanceAccountId) {
        throw new OperationsServiceError(
          "Veuillez configurer les comptes comptables de cet employe.",
          422,
          { advanceAccountId: "Compte avance manquant." },
        );
      }

      // F8-F: amount and advanceToOffset can each individually be within
      // range yet their SUM overflow Decimal(12,2) - checked here, before
      // any accounting line is built, since this is the one place that sum
      // is computed (every other line elsewhere in this function only ever
      // writes amount or advanceToOffset alone, never combined).
      const transferDebit = amount.plus(advanceToOffset);
      assertMoneyRange(transferDebit.toNumber(), "employeeTransfer.debit");

      const settings = await requireSettings(db, organizationId, ["cashAccountId"]);
      return createPostedEntry(db, {
        organizationId,
        date: payload.date,
        reference: payload.operationNumber,
        description: `Transfert salaire - ${payload.employeeName} - ${periodLabel}`,
        journalType: "TREASURY",
        sourceType: "EMPLOYEE_TRANSFER",
        sourceId: payload.operationId,
        createdByUserId: payload.createdByUserId,
        lines: [
          {
            accountId: payload.salaryAccountId,
            label: buildEmployeeTransferSalaryLabel(payload.employeeName),
            debit: transferDebit,
            credit: 0,
          },
          ...(advanceToOffset.gt(0)
            ? [
                {
                  accountId: payload.advanceAccountId!,
                  label: buildEmployeeTransferAdvanceOffsetLabel(payload.employeeName),
                  debit: 0,
                  credit: advanceToOffset,
                },
              ]
            : []),
          {
            accountId: settings.cashAccountId,
            label: buildEmployeeTransferCashLabel(payload.employeeName),
            debit: 0,
            credit: amount,
          },
        ],
      });
    }
  }
}

async function createPostedEntry(db: DbClient, input: CreatePostedEntryInput) {
  const organizationId = await resolveOrganizationId({
    explicitOrganizationId: input.organizationId,
    createdByUserId: input.createdByUserId,
  });
  const normalizedLines = normalizeEntryLines(input.lines);
  assertBalancedEntry(normalizedLines);
  await assertAccountsExist(
    db,
    organizationId,
    normalizedLines.map((line) => line.accountId),
  );

  const entryNumber =
    input.sourceType === "MANUAL_ENTRY" && !input.sourceId
      ? await nextAccountingEntryNumber(db, organizationId, input.date)
      : await nextAccountingEntryNumber(db, organizationId, input.date);

  const created = await db.accountingEntry.create({
    data: {
      organizationId,
      entryNumber,
      date: input.date,
      reference: input.reference ?? null,
      description: input.description,
      journalType: input.journalType,
      status: "POSTED",
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? (input.sourceType === "MANUAL_ENTRY" ? entryNumber : null),
      createdByUserId: input.createdByUserId ?? null,
      lines: {
        create: normalizedLines.map((line) => ({
          accountId: line.accountId,
          label: line.label,
          debit: line.debit,
          credit: line.credit,
          position: line.position,
        })),
      },
    },
    include: entryInclude,
  });

  return created;
}

async function ensureAccountingBootstrap(db: DbClient, organizationId: string) {
  const existing = await db.accountingAccount.findMany({
    where: { organizationId },
    select: { id: true, code: true },
  });

  const existingCodes = new Set(existing.map((account) => account.code));
  const missing = defaultAccountingAccounts.filter(
    (account) => !existingCodes.has(account.code),
  );

  if (missing.length > 0) {
    await db.accountingAccount.createMany({
      data: missing.map((account) => ({
        organizationId,
        code: account.code,
        name: account.name,
        type: account.type,
        isActive: true,
      })),
    });
  }

  const bootstrapAccounts = await db.accountingAccount.findMany({
    where: {
      organizationId,
      code: { in: Object.values(defaultAccountingSettingsByCode) },
    },
    select: { id: true, code: true },
  });

  const accountIdByCode = Object.fromEntries(
    bootstrapAccounts.map((account) => [account.code, account.id]),
  ) as Record<string, string>;

  const currentSettings = await db.accountingSettings.findUnique({
    where: { organizationId },
  });

  if (!currentSettings) {
    await db.accountingSettings.create({
      data: {
        organizationId,
        employeePayrollExpenseAccountId:
          accountIdByCode[defaultAccountingSettingsByCode.employeePayrollExpenseAccountId] ?? null,
        salesAccountId: accountIdByCode[defaultAccountingSettingsByCode.salesAccountId] ?? null,
        salesVatAccountId:
          accountIdByCode[defaultAccountingSettingsByCode.salesVatAccountId] ?? null,
        purchaseAccountId:
          accountIdByCode[defaultAccountingSettingsByCode.purchaseAccountId] ?? null,
        purchaseVatAccountId:
          accountIdByCode[defaultAccountingSettingsByCode.purchaseVatAccountId] ?? null,
        cashAccountId: accountIdByCode[defaultAccountingSettingsByCode.cashAccountId] ?? null,
        bankAccountId: accountIdByCode[defaultAccountingSettingsByCode.bankAccountId] ?? null,
        customerAccountId:
          accountIdByCode[defaultAccountingSettingsByCode.customerAccountId] ?? null,
        supplierAccountId:
          accountIdByCode[defaultAccountingSettingsByCode.supplierAccountId] ?? null,
        customerReturnAccountId:
          accountIdByCode[defaultAccountingSettingsByCode.customerReturnAccountId] ?? null,
        supplierReturnAccountId:
          accountIdByCode[defaultAccountingSettingsByCode.supplierReturnAccountId] ?? null,
        stampEnabled: false,
        stampCalculationMethod: "FIXED_AMOUNT",
        stampValue: new Prisma.Decimal(0),
        stampExpenseAccountId:
          accountIdByCode[defaultAccountingSettingsByCode.stampExpenseAccountId] ?? null,
        stampPayableAccountId:
          accountIdByCode[defaultAccountingSettingsByCode.stampPayableAccountId] ?? null,
      },
    });
    return;
  }

  const defaultsToApply = settingsKeys.reduce<Record<string, string | null>>((acc, key) => {
    if (currentSettings[key]) return acc;
    acc[key] = accountIdByCode[defaultAccountingSettingsByCode[key]] ?? null;
    return acc;
  }, {});

  if (
    currentSettings.cashAccountId === accountIdByCode[accountingSystemAccountCodes.cashLegacy] &&
    accountIdByCode[accountingSystemAccountCodes.cash]
  ) {
    defaultsToApply.cashAccountId = accountIdByCode[accountingSystemAccountCodes.cash];
  }

  if (Object.keys(defaultsToApply).length > 0) {
    await db.accountingSettings.update({
      where: { organizationId },
      data: defaultsToApply,
    });
  }
}

async function requireSettings(
  db: DbClient,
  organizationId: string,
  keys: AccountingAccountSettingsKey[],
): Promise<Record<AccountingAccountSettingsKey, string>> {
  const settings = await db.accountingSettings.findUnique({
    where: { organizationId },
  });

  if (!settings) {
    throw new OperationsServiceError(
      "Parametres comptables introuvables. Configurez le module comptable.",
      409,
    );
  }

  const result = {} as Record<AccountingAccountSettingsKey, string>;

  for (const key of keys) {
    const value = settings[key];
    if (!value) {
      throw new OperationsServiceError(
        `Parametre comptable manquant : ${key}.`,
        409,
      );
    }
    result[key] = value;
  }

  for (const key of settingsKeys) {
    if (!result[key] && settings[key]) {
      result[key] = settings[key];
    }
  }

  return result;
}

async function assertAccountsExist(
  db: DbClient,
  organizationId: string,
  accountIds: string[],
) {
  const uniqueIds = [...new Set(accountIds)];
  const accounts = await db.accountingAccount.findMany({
    where: {
      id: { in: uniqueIds },
      organizationId,
      isActive: true,
    },
    select: { id: true },
  });
  if (accounts.length !== uniqueIds.length) {
    throw new OperationsServiceError(
      "Un compte comptable est introuvable ou inactif.",
      422,
    );
  }
}

async function resolveCustomerAuxiliaryAccountId(
  db: DbClient,
  organizationId: string,
  customerId: string | null,
  generalAccountId: string,
) {
  if (!customerId) return generalAccountId;

  const customer = await db.customer.findFirst({
    where: { id: customerId, organizationId },
    select: { code: true, name: true },
  });
  if (!customer?.code) return generalAccountId;

  const auxiliaryCode = resolveCustomerAuxiliaryCode(customer.code);

  return ensureAccountingAccountByCode(db, organizationId, {
    code: auxiliaryCode,
    name: customer.name,
    type: "RECEIVABLE",
  });
}

async function resolveSupplierAuxiliaryAccountId(
  db: DbClient,
  organizationId: string,
  supplierId: string,
  generalAccountId: string,
) {
  const supplier = await db.supplier.findFirst({
    where: { id: supplierId, organizationId },
    select: { code: true, name: true },
  });
  if (!supplier?.code) return generalAccountId;

  return ensureAccountingAccountByCode(db, organizationId, {
    code: resolveSupplierAuxiliaryCode(supplier.code),
    name: supplier.name,
    type: "PAYABLE",
  });
}

async function requireSystemAccountIdByCode(
  db: DbClient,
  organizationId: string,
  code: string,
) {
  const accountId = await ensureAccountingAccountByCode(db, organizationId, {
    code,
    name:
      defaultAccountingAccounts.find((account) => account.code === code)?.name ??
      code,
    type:
      defaultAccountingAccounts.find((account) => account.code === code)?.type ??
      "ASSET",
  });

  const account = await db.accountingAccount.findFirst({
    where: { id: accountId, organizationId },
    select: { isActive: true },
  });
  if (!account?.isActive) {
    throw new OperationsServiceError(`Le compte comptable ${code} est inactif.`, 409);
  }

  return accountId;
}

export async function ensureAccountingAccountByCode(
  db: DbClient,
  organizationId: string,
  input: { code: string; name: string; type: AccountingAccountType },
) {
  const normalizedCode = normalizeAccountCode(input.code);
  const existing = await db.accountingAccount.findFirst({
    where: { code: normalizedCode, organizationId },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await db.accountingAccount.create({
    data: {
      organizationId,
      code: normalizedCode,
      name: input.name,
      type: input.type,
      isActive: true,
    },
    select: { id: true },
  });

  return created.id;
}

async function resolveOrganizationId(input: {
  explicitOrganizationId?: string | null;
  createdByUserId?: string | null;
  saleId?: string | null;
  purchaseId?: string | null;
  creditNoteId?: string | null;
  employeeId?: string | null;
}) {
  if (input.explicitOrganizationId) {
    return input.explicitOrganizationId;
  }

  if (input.createdByUserId) {
    const user = await prisma.user.findUnique({
      where: { id: input.createdByUserId },
      select: { organizationId: true },
    });
    if (user?.organizationId) {
      return user.organizationId;
    }
  }

  if (input.saleId) {
    const sale = await prisma.sale.findUnique({
      where: { id: input.saleId },
      select: { organizationId: true },
    });
    if (sale?.organizationId) {
      return sale.organizationId;
    }
  }

  if (input.purchaseId) {
    const purchase = await prisma.purchase.findUnique({
      where: { id: input.purchaseId },
      select: { organizationId: true },
    });
    if (purchase?.organizationId) {
      return purchase.organizationId;
    }
  }

  if (input.creditNoteId) {
    const creditNote = await prisma.creditNote.findUnique({
      where: { id: input.creditNoteId },
      select: { organizationId: true },
    });
    if (creditNote?.organizationId) {
      return creditNote.organizationId;
    }
  }

  if (input.employeeId) {
    const employee = await prisma.employee.findUnique({
      where: { id: input.employeeId },
      select: { organizationId: true },
    });
    if (employee?.organizationId) {
      return employee.organizationId;
    }
  }

  const currentUser = await getCurrentSessionUser();
  if (currentUser?.organizationId) {
    return currentUser.organizationId;
  }

  throw new OperationsServiceError("Aucune organisation n'est associee a cette operation.", 403);
}

// F8-F: the single choke point every AccountingEntryLine ever created in
// this app funnels through (called both directly by createManualAccountingEntry
// and, universally, by createPostedEntry - which every post*AccountingEntry
// function in this file goes through). debit/credit are Decimal(12,2), so
// each is range-checked right after being parsed by toMoneyDecimal (which
// already rejects a non-finite/non-numeric value, e.g. "abc" - the range
// check here is what was missing for a value that parses fine but is too
// large, e.g. the string "10000000000"). Every other caller in this file
// already passes an amount checked upstream (F8-D/F8-E/F8-F), so this is
// pure defense-in-depth for them and the actual new gate for manual entries
// (manualEntrySchema's debit/credit accept `number | string` with no bound
// of their own).
function normalizeEntryLines(
  lines: Array<{
    accountId: string;
    label: string;
    debit: DecimalInput;
    credit: DecimalInput;
  }>,
): NormalizedEntryLine[] {
  return lines.map((line, index) => {
    const debit = toMoneyDecimal(line.debit);
    const credit = toMoneyDecimal(line.credit);
    assertMoneyRange(debit.toNumber(), "entryLine.debit");
    assertMoneyRange(credit.toNumber(), "entryLine.credit");
    return {
      accountId: line.accountId,
      label: line.label.trim(),
      debit,
      credit,
      position: index,
    };
  });
}

function assertBalancedEntry(lines: NormalizedEntryLine[]) {
  if (lines.length < 2) {
    throw new OperationsServiceError(
      "Une ecriture doit contenir au moins deux lignes.",
      422,
    );
  }

  let totalDebit = new Prisma.Decimal(0);
  let totalCredit = new Prisma.Decimal(0);

  for (const line of lines) {
    const hasDebit = line.debit.gt(0);
    const hasCredit = line.credit.gt(0);

    if (line.debit.lt(0) || line.credit.lt(0)) {
      throw new OperationsServiceError(
        "Les montants doivent etre positifs.",
        422,
      );
    }
    if (hasDebit === hasCredit) {
      throw new OperationsServiceError(
        "Chaque ligne doit contenir soit un debit, soit un credit.",
        422,
      );
    }

    totalDebit = totalDebit.plus(line.debit);
    totalCredit = totalCredit.plus(line.credit);
  }

  if (!totalDebit.eq(totalCredit)) {
    throw new OperationsServiceError(
      "L'ecriture comptable n'est pas equilibree.",
      422,
    );
  }
}

function mapEntryToDto(entry: {
  id: string;
  entryNumber: string;
  date: Date;
  reference: string | null;
  description: string;
  journalType: AccountingJournalType;
  status: "DRAFT" | "POSTED" | "REVERSED";
  sourceType: AccountingSourceType | null;
  sourceId: string | null;
  createdByUserId: string | null;
  createdBy: { id: string; fullName: string } | null;
  lines: Array<{
    id: string;
    accountId: string;
    operationNumber: number;
    account: { id: string; code: string; name: string };
    label: string;
    debit: Prisma.Decimal;
    credit: Prisma.Decimal;
    position: number;
  }>;
  createdAt: Date;
  updatedAt: Date;
}): AccountingEntryDto {
  const totalDebit = entry.lines.reduce(
    (sum, line) => sum.plus(line.debit),
    new Prisma.Decimal(0),
  );
  const totalCredit = entry.lines.reduce(
    (sum, line) => sum.plus(line.credit),
    new Prisma.Decimal(0),
  );

  return {
    id: entry.id,
    entryNumber: entry.entryNumber,
    date: entry.date.toISOString(),
    reference: entry.reference ?? null,
    description: entry.description,
    journalType: entry.journalType,
    status: entry.status,
    sourceType: entry.sourceType,
    sourceId: entry.sourceId ?? null,
    createdByUserId: entry.createdByUserId ?? null,
    createdByUserName: entry.createdBy?.fullName ?? null,
    totalDebit: totalDebit.toNumber(),
    totalCredit: totalCredit.toNumber(),
    lines: entry.lines.map((line) => ({
      id: line.id,
      accountId: line.accountId,
      accountCode: line.account.code,
      accountName: line.account.name,
      operationNumber: line.operationNumber,
      label: line.label,
      debit: line.debit.toNumber(),
      credit: line.credit.toNumber(),
      position: line.position,
    })),
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

async function buildJournalMetadata(
  db: DbClient,
  organizationId: string,
  entries: AccountingEntryDto[],
) {
  const saleIds = entries
    .filter((entry) => entry.sourceType === "SALE" && entry.sourceId)
    .map((entry) => entry.sourceId!);
  const paymentIds = entries
    .filter((entry) => entry.sourceType === "CUSTOMER_PAYMENT" && entry.sourceId)
    .map((entry) => entry.sourceId!);
  const employeeOperationIds = entries
    .filter(
      (entry) =>
        entry.sourceId &&
        ["EMPLOYEE_ADVANCE", "EMPLOYEE_REMUNERATION", "EMPLOYEE_TRANSFER"].includes(
          entry.sourceType ?? "",
        ),
    )
    .map((entry) => entry.sourceId!);

  const [sales, payments, employeeOperations] = await Promise.all([
    saleIds.length > 0
      ? db.sale.findMany({
          where: { id: { in: saleIds }, organizationId },
          select: {
            id: true,
            invoiceNumber: true,
            customer: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    paymentIds.length > 0
      ? db.payment.findMany({
          where: { id: { in: paymentIds }, organizationId },
          select: {
            id: true,
            method: true,
            reference: true,
            sale: {
              select: {
                invoiceNumber: true,
                customer: { select: { name: true } },
              },
            },
          },
        })
      : Promise.resolve([]),
    employeeOperationIds.length > 0
      ? db.employeeTransaction.findMany({
          where: { id: { in: employeeOperationIds }, organizationId },
          select: {
            id: true,
            number: true,
            type: true,
            employee: { select: { fullName: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const metadata = new Map<
    string,
    { invoiceNumber: string | null; checkNumber: string | null; partyName: string | null }
  >();

  for (const sale of sales) {
    metadata.set(`SALE:${sale.id}`, {
      invoiceNumber: sale.invoiceNumber,
      checkNumber: null,
      partyName: sale.customer?.name ?? null,
    });
  }

  for (const payment of payments) {
    metadata.set(`CUSTOMER_PAYMENT:${payment.id}`, {
      invoiceNumber: payment.sale.invoiceNumber,
      checkNumber: payment.method === "CHECK" ? payment.reference ?? null : null,
      partyName: payment.sale.customer?.name ?? null,
    });
  }

  for (const operation of employeeOperations) {
    const sourceType =
      operation.type === "ADVANCE"
        ? "EMPLOYEE_ADVANCE"
        : operation.type === "TRANSFER"
          ? "EMPLOYEE_TRANSFER"
          : "EMPLOYEE_REMUNERATION";
    metadata.set(`${sourceType}:${operation.id}`, {
      invoiceNumber: operation.number,
      checkNumber: null,
      partyName: operation.employee.fullName,
    });
  }

  return metadata;
}

function compareJournalEntries(
  left: AccountingEntryDto,
  right: AccountingEntryDto,
  metadata: Map<
    string,
    { invoiceNumber: string | null; checkNumber: string | null; partyName: string | null }
  >,
) {
  const dateCompare = right.date.localeCompare(left.date);
  if (dateCompare !== 0) return dateCompare;

  const leftMeta = metadata.get(`${left.sourceType ?? "none"}:${left.sourceId ?? "none"}`) ?? null;
  const rightMeta =
    metadata.get(`${right.sourceType ?? "none"}:${right.sourceId ?? "none"}`) ?? null;
  const leftInvoiceNumber = leftMeta?.invoiceNumber ?? left.reference ?? null;
  const rightInvoiceNumber = rightMeta?.invoiceNumber ?? right.reference ?? null;

  if (
    leftInvoiceNumber &&
    rightInvoiceNumber &&
    leftInvoiceNumber === rightInvoiceNumber
  ) {
    const sourceCompare =
      getJournalSourceOrder(left.sourceType) - getJournalSourceOrder(right.sourceType);
    if (sourceCompare !== 0) return sourceCompare;
  }

  const createdCompare = right.createdAt.localeCompare(left.createdAt);
  if (createdCompare !== 0) return createdCompare;

  return right.entryNumber.localeCompare(left.entryNumber);
}

function getJournalSourceOrder(sourceType: AccountingSourceType | null) {
  switch (sourceType) {
    case "SALE":
      return 0;
    case "CUSTOMER_PAYMENT":
      return 1;
    default:
      return 10;
  }
}

function mapSettingsToDto(settings: {
  id: string;
  employeePayrollExpenseAccountId: string | null;
  salesAccountId: string | null;
  salesVatAccountId: string | null;
  purchaseAccountId: string | null;
  purchaseVatAccountId: string | null;
  cashAccountId: string | null;
  bankAccountId: string | null;
  customerAccountId: string | null;
  supplierAccountId: string | null;
  customerReturnAccountId: string | null;
  supplierReturnAccountId: string | null;
  stampEnabled: boolean;
  stampCalculationMethod: AccountingStampCalculationMethod;
  stampValue: Prisma.Decimal;
  stampExpenseAccountId: string | null;
  stampPayableAccountId: string | null;
  updatedByUserId: string | null;
  updatedBy: { id: string; fullName: string } | null;
  createdAt: Date;
  updatedAt: Date;
}): AccountingSettingsDto {
  return {
    id: settings.id,
    employeePayrollExpenseAccountId: settings.employeePayrollExpenseAccountId,
    salesAccountId: settings.salesAccountId,
    salesVatAccountId: settings.salesVatAccountId,
    purchaseAccountId: settings.purchaseAccountId,
    purchaseVatAccountId: settings.purchaseVatAccountId,
    cashAccountId: settings.cashAccountId,
    bankAccountId: settings.bankAccountId,
    customerAccountId: settings.customerAccountId,
    supplierAccountId: settings.supplierAccountId,
    customerReturnAccountId: settings.customerReturnAccountId,
    supplierReturnAccountId: settings.supplierReturnAccountId,
    stampEnabled: settings.stampEnabled,
    stampCalculationMethod: settings.stampCalculationMethod,
    stampValue: settings.stampValue.toNumber(),
    stampExpenseAccountId: settings.stampExpenseAccountId,
    stampPayableAccountId: settings.stampPayableAccountId,
    updatedByUserId: settings.updatedByUserId ?? null,
    updatedByUserName: settings.updatedBy?.fullName ?? null,
    createdAt: settings.createdAt.toISOString(),
    updatedAt: settings.updatedAt.toISOString(),
  };
}

async function nextAccountingEntryNumber(
  db: DbClient,
  organizationId: string,
  date: Date,
) {
  const scopeDate = formatSequenceDate(date);
  const prefix = `EC-${scopeDate}-`;
  const number = await reserveDocumentSequence(
    db,
    organizationId,
    DocumentType.AccountingEntry,
    scopeDate,
  );
  return `${prefix}${String(number).padStart(6, "0")}`;
}

function parseAccountingDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    throw new OperationsServiceError("Date comptable invalide.", 422);
  }
  return date;
}

function toMoneyDecimal(value: DecimalInput) {
  try {
    return new Prisma.Decimal(value).toDecimalPlaces(2);
  } catch {
    throw new OperationsServiceError("Montant comptable invalide.", 422);
  }
}

function usesBankAccount(paymentMethod: string) {
  return paymentMethod === "CARD" || paymentMethod === "CHECK" || paymentMethod === "BANK_TRANSFER";
}

function usesPurchaseBankAccount(paymentMethod: string) {
  return paymentMethod === "carte" || paymentMethod === "cheque" || paymentMethod === "virement";
}

export function resolveCustomerAuxiliaryCode(code: string) {
  const normalizedCode = normalizeAccountCode(code);

  if (/^3421\d+$/.test(normalizedCode)) {
    return normalizedCode;
  }

  // Imported customers keep their commercial/POS number in Customer.code.
  // Their auxiliary ledger account is the textual prefix "3421" plus it.
  if (/^\d+$/.test(normalizedCode)) {
    return `3421${normalizedCode}`;
  }

  const legacyMatch = normalizedCode.match(/^CLI-0*(\d+)$/);
  if (legacyMatch) {
    return `${accountingSystemAccountCodes.customerGeneral}${Number(legacyMatch[1])}`;
  }

  return normalizedCode;
}

export function resolveSupplierAuxiliaryCode(code: string) {
  const normalizedCode = normalizeAccountCode(code);

  if (/^4411\d+$/.test(normalizedCode)) {
    return normalizedCode;
  }

  const legacyMatch = normalizedCode.match(/^FOU-0*(\d+)$/);
  if (legacyMatch) {
    return `${accountingSystemAccountCodes.supplierGeneral}${Number(legacyMatch[1])}`;
  }

  return normalizedCode;
}

function buildSaleInvoiceCustomerLabel(invoiceNumber: string) {
  return `Achat facture num: ${invoiceNumber}`;
}

function buildSaleStampExpenseLabel(invoiceNumber: string) {
  return `Frais de timbre fac num: ${invoiceNumber}`;
}

function buildSaleRevenueLabel() {
  return "Ventes de marchandises";
}

function buildSaleVatLabel() {
  return "Etat TVA facturee";
}

function buildSaleStampPayableLabel() {
  return "Etat impot et taxe a payer (TIMBRE)";
}

function buildSaleSettlementLabel() {
  return "Reglement facture";
}

function buildPurchaseExpenseLabel() {
  return "Achats de marchandises";
}

function buildPurchaseVatLabel() {
  return "Etat TVA recuperable";
}

function buildPurchaseSupplierLabel(purchaseNumber: string) {
  return `Facture achat ${purchaseNumber}`;
}

function buildPurchaseSettlementLabel() {
  return "Reglement achat fournisseur";
}

function buildEmployeeAdvanceLabel(employeeName: string) {
  return `Avance au personnel - ${employeeName}`;
}

function buildEmployeeAdvanceCashLabel(employeeName: string) {
  return `Caisse - Avance au personnel - ${employeeName}`;
}

function buildEmployeePayrollExpenseLabel(employeeName: string) {
  return `Remuneration du personnel - ${employeeName}`;
}

function buildEmployeeSalaryDueLabel(employeeName: string) {
  return `Remuneration due au personnel - ${employeeName}`;
}

function buildEmployeeTransferSalaryLabel(employeeName: string) {
  return `Reglement salaire personnel - ${employeeName}`;
}

function buildEmployeeTransferAdvanceOffsetLabel(employeeName: string) {
  return `Apurement avances personnel - ${employeeName}`;
}

function buildEmployeeTransferCashLabel(employeeName: string) {
  return `Caisse - Reglement salaire - ${employeeName}`;
}

export function normalizeAccountCode(code: string) {
  return code.trim().replace(/\s+/g, "").toUpperCase();
}

function formatSequenceDate(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function formatPayrollPeriod(payrollYear: number, payrollMonth: number) {
  return `${String(payrollMonth).padStart(2, "0")}/${payrollYear}`;
}
