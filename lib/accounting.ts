import type {
  AccountingAccountType,
  AccountingJournalType,
  AccountingAccountSettingsKey,
  AccountingStampCalculationMethod,
  AccountingSourceType,
} from "@/types/accounting";

export const accountingAccountTypeLabels: Record<AccountingAccountType, string> = {
  ASSET: "Actif",
  LIABILITY: "Passif",
  EQUITY: "Capitaux propres",
  REVENUE: "Produit",
  EXPENSE: "Charge",
  TREASURY: "Tresorerie",
  RECEIVABLE: "Client",
  PAYABLE: "Fournisseur",
  TAX: "TVA",
};

export const accountingJournalTypeLabels: Record<AccountingJournalType, string> = {
  GENERAL: "General",
  SALES: "Ventes",
  PURCHASES: "Achats",
  TREASURY: "Tresorerie",
  CREDIT_NOTES: "Avoirs",
  MANUAL: "Manuel",
};

export const accountingSourceTypeLabels: Record<AccountingSourceType, string> = {
  MANUAL_ENTRY: "Ecriture manuelle",
  SALE: "Vente",
  CUSTOMER_CREDIT_NOTE: "Avoir client",
  SUPPLIER_CREDIT_NOTE: "Avoir fournisseur",
  PURCHASE: "Achat",
  CUSTOMER_PAYMENT: "Paiement client",
  SUPPLIER_PAYMENT: "Paiement fournisseur",
  EMPLOYEE_ADVANCE: "Avance employe",
  EMPLOYEE_REMUNERATION: "Remuneration du personnel",
  EMPLOYEE_TRANSFER: "Transfert salaire",
};

export const defaultAccountingAccounts: Array<{
  code: string;
  name: string;
  type: AccountingAccountType;
}> = [
  { code: "6171", name: "Remuneration du personnel", type: "EXPENSE" },
  { code: "7111", name: "Ventes de marchandises", type: "REVENUE" },
  { code: "3421", name: "Clients", type: "RECEIVABLE" },
  { code: "4411", name: "Fournisseurs", type: "PAYABLE" },
  { code: "3455", name: "TVA recuperable", type: "TAX" },
  { code: "4455", name: "Etat TVA facturee", type: "TAX" },
  { code: "44571", name: "Etat impot et taxe a payer (TIMBRE)", type: "TAX" },
  { code: "5161", name: "Caisse", type: "TREASURY" },
  { code: "51611", name: "Caisse principale", type: "TREASURY" },
  { code: "6585", name: "Frais de timbre", type: "EXPENSE" },
  { code: "5141", name: "Banque", type: "TREASURY" },
  { code: "6111", name: "Achats marchandises", type: "EXPENSE" },
  { code: "7119", name: "Retours sur ventes", type: "REVENUE" },
  { code: "6119", name: "Retours sur achats", type: "EXPENSE" },
  { code: "117", name: "Avoir Client", type: "LIABILITY" },
  { code: "34552", name: "Etat - TVA recuperable sur charges", type: "TAX" },
];

export const defaultAccountingSettingsByCode: Record<AccountingAccountSettingsKey, string> = {
  employeePayrollExpenseAccountId: "6171",
  salesAccountId: "7111",
  salesVatAccountId: "4455",
  purchaseAccountId: "6111",
  purchaseVatAccountId: "3455",
  cashAccountId: "51611",
  bankAccountId: "5141",
  customerAccountId: "3421",
  supplierAccountId: "4411",
  customerReturnAccountId: "7119",
  supplierReturnAccountId: "6119",
  stampExpenseAccountId: "6585",
  stampPayableAccountId: "44571",
};

export const accountingSystemAccountCodes = {
  employeePayrollExpense: "6171",
  sales: "7111",
  salesVat: "4455",
  stampExpense: "6585",
  stampTaxPayable: "44571",
  cashLegacy: "5161",
  cash: "51611",
  bank: "5141",
  customerGeneral: "3421",
  supplierGeneral: "4411",
  purchase: "6111",
  purchaseVat: "3455",
  customerReturn: "7119",
  supplierReturn: "6119",
  /** Transit account for a cash-refunded customer credit note (avoir client especes). */
  customerCashCreditNoteTransit: "117",
  /** VAT recoverable on cash-refunded supplier credit notes (avoir fournisseur especes). */
  supplierCashCreditNoteVat: "34552",
  /**
   * Cheque en portefeuille - dedicated treasury account for CHECK/cheque
   * settlements (never 5141 Banque, see postSaleAccountingEntry). Unlike
   * every other code in this object, this one is NOT in
   * defaultAccountingAccounts and must NEVER be added there: it is resolved
   * by a strict, non-auto-creating lookup (requireExistingAccountByCode in
   * lib/server/accounting.ts) that throws a clear error if the org hasn't
   * configured it yet, rather than silently bootstrapping a generic
   * placeholder account under this code.
   */
  chequeInPortfolio: "51111",
} as const;

export const accountingStampCalculationMethodLabels: Record<
  AccountingStampCalculationMethod,
  string
> = {
  FIXED_AMOUNT: "Montant fixe",
  PERCENTAGE_OF_TOTAL_TTC: "Pourcentage du total TTC",
};

export const accountingSettingsFieldDefinitions: Array<{
  key: AccountingAccountSettingsKey;
  label: string;
  hint: string;
}> = [
  {
    key: "employeePayrollExpenseAccountId",
    label: "Charge paie personnel",
    hint: "Compte de charge debite lors de la constatation de la remuneration.",
  },
  {
    key: "salesAccountId",
    label: "Compte ventes",
    hint: "Compte de produit credite lors d'une vente.",
  },
  {
    key: "salesVatAccountId",
    label: "TVA facturee",
    hint: "Compte TVA utilise sur les ventes et les avoirs clients.",
  },
  {
    key: "purchaseAccountId",
    label: "Compte achats",
    hint: "Compte de charge utilise lors d'un achat.",
  },
  {
    key: "purchaseVatAccountId",
    label: "TVA recuperable",
    hint: "Compte TVA utilise sur les achats et les avoirs fournisseurs.",
  },
  {
    key: "cashAccountId",
    label: "Caisse",
    hint: "Compte de tresorerie pour les reglements especes.",
  },
  {
    key: "bankAccountId",
    label: "Banque",
    // Cheque no longer settles here - see accountingSystemAccountCodes.chequeInPortfolio (51111).
    hint: "Compte de tresorerie pour carte et virement.",
  },
  {
    key: "customerAccountId",
    label: "Clients",
    hint: "Compte auxiliaire client pour les encours et remboursements.",
  },
  {
    key: "supplierAccountId",
    label: "Fournisseurs",
    hint: "Compte auxiliaire fournisseur pour les achats et retours.",
  },
  {
    key: "customerReturnAccountId",
    label: "Retours clients",
    hint: "Compte utilise pour les avoirs clients valides.",
  },
  {
    key: "supplierReturnAccountId",
    label: "Retours fournisseurs",
    hint: "Compte utilise pour les avoirs fournisseurs valides.",
  },
  {
    key: "stampExpenseAccountId",
    label: "Frais de timbre",
    hint: "Compte de charge debite lorsque le timbre est applique.",
  },
  {
    key: "stampPayableAccountId",
    label: "Timbre a payer",
    hint: "Compte fiscal credite lorsque le timbre est applique.",
  },
];
