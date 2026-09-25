/**
 * Shared fixtures for the counter-pos unit tests (never imported by app code).
 * A test file MUST `import "fake-indexeddb/auto"` before importing this, so the
 * IndexedDB globals exist when Dexie loads.
 */

import assert from "node:assert/strict";

import { addMoney } from "@/lib/money";
import { computeDiscountedLineTotals } from "@/lib/pos-discount";
import type { CounterPosContextDto } from "@/types/operations-dto";

import type { StoreResult } from "./schema";
import type { OfflineSaleInput, OfflineSaleLineInput } from "./sales-store";

let counter = 0;

/** A fresh organization id per call: each test gets its own IndexedDB database. */
export function uniqueOrg(prefix = "org"): string {
  counter += 1;
  return `${prefix}-${process.pid}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}

export function unwrap<T>(result: StoreResult<T>): T {
  assert.equal(result.ok, true, result.ok ? "" : `${result.code}: ${result.message}`);
  return (result as { ok: true; value: T }).value;
}

export function failureOf<T>(result: StoreResult<T>): { code: string; message: string } {
  assert.equal(result.ok, false, "expected a failure");
  return result as { ok: false; code: string; message: string };
}

export function makeLine(
  productId: string,
  quantity: number,
  options: { unitPriceHT?: number; taxRate?: number; discountUnitAmount?: number } = {},
): OfflineSaleLineInput {
  const unitPriceHT = options.unitPriceHT ?? 10;
  const taxRate = options.taxRate ?? 20;
  const totals = computeDiscountedLineTotals({
    unitPriceHT,
    taxRate,
    quantity,
    discountUnitAmount: options.discountUnitAmount ?? 0,
  });
  return {
    productId,
    productReference: `REF-${productId}`,
    productName: `Produit ${productId}`,
    quantity,
    unitPriceHT,
    taxRate,
    discountUnitAmount: totals.discountUnitAmount,
    discountAmount: totals.discountAmount,
    totalHT: totals.totalHT,
    taxAmount: totals.taxAmount,
    totalTTC: totals.totalTTC,
  };
}

/** A CASH sale paid in full, with totals derived from its lines. */
export function makeSaleInput(
  lines: OfflineSaleLineInput[],
  overrides: Partial<OfflineSaleInput> = {},
): OfflineSaleInput {
  const subtotalHT = addMoney(...lines.map((l) => l.totalHT));
  const taxAmount = addMoney(...lines.map((l) => l.taxAmount));
  const discountAmount = addMoney(...lines.map((l) => l.discountAmount));
  const totalTTC = addMoney(subtotalHT, taxAmount);
  return {
    depotId: "depot-1",
    stockLocationId: "loc-1",
    customer: { id: "cust-1", code: "34211", name: "Client Un" },
    paymentMethod: "CASH",
    lines,
    payments: [{ method: "CASH", amount: totalTTC }],
    totals: { subtotalHT, discountAmount, taxAmount, totalTTC, paidAmount: totalTTC, creditAmount: 0 },
    ...overrides,
  };
}

export function makeContext(
  overrides: Partial<CounterPosContextDto> = {},
): CounterPosContextDto {
  return {
    canSell: true,
    user: { id: "user-1", name: "Caissier Un" },
    depot: { id: "depot-1", code: "DEP-01", name: "Depot 1" },
    stockLocation: { id: "loc-1", code: "LOC-1", name: "Depot 1 - stock" },
    customers: [
      {
        id: "cust-1",
        code: "34211",
        displayCode: "3421/1",
        name: "Client Un",
        phone: "0600000001",
        email: "secret@example.com",
        address: "1 rue Privee",
        city: "Casablanca",
        type: "COUNTER",
        status: "ACTIVE",
        creditLimit: 5000,
        creditLimitEnabled: true,
        currentBalance: 1234.5,
        notes: "note privee",
        createdByUserId: "u0",
        createdByUserName: "Admin",
        creationOrigin: "ADMIN",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "cust-2",
        code: "34212",
        displayCode: "3421/2",
        name: "Client Deux",
        phone: null,
        address: "",
        city: "Rabat",
        type: "RETAIL",
        status: "ACTIVE",
        creditLimit: 0,
        creditLimitEnabled: false,
        currentBalance: 0,
        createdByUserId: "u0",
        createdByUserName: "Admin",
        creationOrigin: "ADMIN",
        createdAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ],
    defaultCustomerId: "cust-1",
    products: [
      {
        id: "p1",
        reference: "COCA-1L",
        barcode: "611000000001",
        name: "Coca 1L",
        imageUrl: null,
        salePriceHT: 10,
        salePriceTTC: 12,
        taxRate: 20,
        availableQuantity: 20,
        supplierId: "sup-1",
        supplierName: "Fournisseur Un",
        supplierLogoUrl: null,
      },
      {
        id: "p2",
        reference: "FANTA-1L",
        barcode: null,
        name: "Fanta 1L",
        imageUrl: "https://example.test/fanta.png",
        salePriceHT: 8.33,
        salePriceTTC: 10,
        taxRate: 20,
        availableQuantity: 0,
        supplierId: null,
        supplierName: null,
        supplierLogoUrl: null,
      },
      {
        id: "p3",
        reference: "EAU-5L",
        barcode: "611000000003",
        name: "Eau 5L",
        imageUrl: null,
        salePriceHT: 5,
        salePriceTTC: 5.5,
        taxRate: 10,
        availableQuantity: 100,
        supplierId: "sup-1",
        supplierName: "Fournisseur Un",
        supplierLogoUrl: null,
      },
    ],
    productsTruncated: false,
    bankAccounts: [{ id: "bank-1", code: "51410001", name: "Banque Populaire" }],
    ...overrides,
  };
}
