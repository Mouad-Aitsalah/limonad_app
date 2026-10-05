import Decimal from "decimal.js-light";

/**
 * The accounting lines of a customer SALE invoice and of a customer CREDIT NOTE,
 * including the explicit commercial-rounding line (Sale.roundingAmount,
 * CreditNote.roundingAmount - see lib/sale-rounding.ts).
 *
 * Pure: it receives the already resolved account ids and the labels, and returns
 * the lines that lib/server/accounting.ts posts. Extracted so the balance of the
 * entries - with and without stamp, for a gain and for a loss, for every refund
 * method - is unit-tested without a database. Every entry built here is checked
 * balanced before it is returned (assertBalancedLines).
 *
 * Rounding rule on the INVOICE (roundingAmount = totalTTC - (HT + VAT)):
 *   > 0  the customer pays more than HT + VAT -> CREDIT of the rounding GAIN account
 *   < 0  the customer pays less               -> DEBIT of the rounding LOSS account
 * and the inverse on a credit note, which gives the share back.
 * HT and VAT are never touched to absorb the difference.
 */

export type EntryLine = { accountId: string; label: string; debit: number; credit: number };

export type RoundingAccountIds = {
  /** Account credited by a rounding gain (null when the entry has no gain to post). */
  gain: string | null;
  /** Account debited by a rounding loss (null when the entry has no loss to post). */
  loss: string | null;
};

function sum(lines: EntryLine[], key: "debit" | "credit"): Decimal {
  return lines.reduce((total, line) => total.plus(line[key]), new Decimal(0));
}

/** Throws when debits and credits differ (never posts an unbalanced entry). */
export function assertBalancedLines(lines: EntryLine[]): EntryLine[] {
  if (!sum(lines, "debit").eq(sum(lines, "credit"))) {
    throw new Error(
      `Ecriture desequilibree : debit ${sum(lines, "debit").toFixed(2)} / credit ${sum(lines, "credit").toFixed(2)}.`,
    );
  }
  return lines;
}

function roundingAccountFor(accounts: RoundingAccountIds, side: "gain" | "loss"): string {
  const accountId = accounts[side];
  if (!accountId) {
    throw new Error(`Compte d'arrondi (${side === "gain" ? "produit" : "charge"}) non resolu.`);
  }
  return accountId;
}

export type SaleInvoiceLinesInput = {
  totalTTC: number;
  subtotalHT: number;
  taxAmount: number;
  stampAmount: number;
  /** totalTTC - (subtotalHT + taxAmount), signed. */
  roundingAmount: number;
  accounts: {
    customer: string;
    sales: string;
    vat: string;
    stampExpense: string | null;
    stampPayable: string | null;
    rounding: RoundingAccountIds;
  };
  labels: {
    customer: string;
    revenue: string;
    vat: string;
    stampExpense: string;
    stampPayable: string;
    rounding: string;
  };
};

/** The lines of the SALES-journal entry of an invoice (same order and labels as before the rounding). */
export function buildSaleInvoiceEntryLines(input: SaleInvoiceLinesInput): EntryLine[] {
  const { accounts, labels } = input;
  const hasStamp = input.stampAmount > 0;
  if (hasStamp && (!accounts.stampExpense || !accounts.stampPayable)) {
    throw new Error("Comptes de timbre non resolus.");
  }

  const lines: EntryLine[] = [
    { accountId: accounts.customer, label: labels.customer, debit: input.totalTTC, credit: 0 },
  ];
  if (hasStamp) {
    lines.push({ accountId: accounts.stampExpense!, label: labels.stampExpense, debit: input.stampAmount, credit: 0 });
  }
  lines.push({ accountId: accounts.sales, label: labels.revenue, debit: 0, credit: input.subtotalHT });
  if (input.taxAmount > 0) {
    lines.push({ accountId: accounts.vat, label: labels.vat, debit: 0, credit: input.taxAmount });
  }
  if (hasStamp) {
    lines.push({ accountId: accounts.stampPayable!, label: labels.stampPayable, debit: 0, credit: input.stampAmount });
  }
  if (input.roundingAmount > 0) {
    lines.push({
      accountId: roundingAccountFor(accounts.rounding, "gain"),
      label: labels.rounding,
      debit: 0,
      credit: input.roundingAmount,
    });
  } else if (input.roundingAmount < 0) {
    lines.push({
      accountId: roundingAccountFor(accounts.rounding, "loss"),
      label: labels.rounding,
      debit: Math.abs(input.roundingAmount),
      credit: 0,
    });
  }
  return assertBalancedLines(lines);
}

export type CustomerCreditNoteLinesInput = {
  refundMethod: "CASH" | "BANK";
  subtotalHT: number;
  taxAmount: number;
  /** Final amount of the note: subtotalHT + taxAmount + roundingAmount. */
  totalTTC: number;
  /** The share of the sale's rounding given back (signed like Sale.roundingAmount). */
  roundingAmount: number;
  accounts: {
    /** CASH refund: 7111 / 117 transit / cash. */
    sales?: string;
    transit?: string;
    cash?: string;
    /** Non-cash refund: 7119 / VAT / customer. */
    customerReturn?: string;
    vat?: string;
    customer?: string;
    rounding: RoundingAccountIds;
  };
  labels: { cash: string; customerReturn: string; vat: string; customer: string; rounding: string };
};

/**
 * The lines of a customer credit note. The rounding it gives back is the inverse
 * of the invoice's: a positive share (the customer had paid more) DEBITS the gain
 * account, a negative one CREDITS the loss account.
 */
export function buildCustomerCreditNoteEntryLines(input: CustomerCreditNoteLinesInput): EntryLine[] {
  const { accounts, labels } = input;
  const share = input.roundingAmount;

  const roundingLine = (): EntryLine[] => {
    if (share > 0) {
      return [{ accountId: roundingAccountFor(accounts.rounding, "gain"), label: labels.rounding, debit: share, credit: 0 }];
    }
    if (share < 0) {
      return [
        { accountId: roundingAccountFor(accounts.rounding, "loss"), label: labels.rounding, debit: 0, credit: Math.abs(share) },
      ];
    }
    return [];
  };

  if (input.refundMethod === "CASH") {
    // Fixed 4-line structure (7111 / 117 / 117 / cash) at the gross amount, kept as
    // requested; only the first line is split so the rounding has its own line.
    const salesDebit = new Decimal(input.totalTTC).minus(share).toNumber();
    if (salesDebit < 0) throw new Error("Avoir incoherent : arrondi superieur au montant.");
    return assertBalancedLines([
      { accountId: accounts.sales!, label: labels.cash, debit: salesDebit, credit: 0 },
      ...roundingLine(),
      { accountId: accounts.transit!, label: labels.cash, debit: 0, credit: input.totalTTC },
      { accountId: accounts.transit!, label: labels.cash, debit: input.totalTTC, credit: 0 },
      { accountId: accounts.cash!, label: labels.cash, debit: 0, credit: input.totalTTC },
    ]);
  }

  return assertBalancedLines([
    { accountId: accounts.customerReturn!, label: labels.customerReturn, debit: input.subtotalHT, credit: 0 },
    ...(input.taxAmount > 0
      ? [{ accountId: accounts.vat!, label: labels.vat, debit: input.taxAmount, credit: 0 }]
      : []),
    ...roundingLine(),
    { accountId: accounts.customer!, label: labels.customer, debit: 0, credit: input.totalTTC },
  ]);
}
