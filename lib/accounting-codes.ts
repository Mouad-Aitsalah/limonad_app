import { accountingSystemAccountCodes } from "@/lib/accounting";

// The account-code helpers of the ledger, moved UNCHANGED from
// lib/server/accounting.ts (which re-exports them) so that pure / tested code
// (the accounts import core) uses exactly the same rules without the
// "server-only" marker.

export function normalizeAccountCode(code: string) {
  return code.trim().replace(/\s+/g, "").toUpperCase();
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
