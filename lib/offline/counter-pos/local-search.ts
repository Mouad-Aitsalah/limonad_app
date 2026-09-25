"use client";

/**
 * COUNTER POS - customer lookups against the local mirror (Phase 4).
 *
 * Only customers already synchronised on this PC can be found; the local
 * mirror is the ONLY source while offline, so nothing here invents a customer.
 * Blocked customers are never returned (the server would refuse them at sync).
 * Products need no function of their own: offline the POS loads the full
 * mirrored catalogue and filters it with its existing product search.
 */

import { customerAccountNumber, resolveCustomerCodeFromInput } from "@/lib/customer-code";
import type { CustomerDto } from "@/types/operations-dto";

import { assertScope, runStorage } from "./database";
import { customerDtoFromRecord } from "./pos-data-source";
import type { CounterPosScope } from "./schema";

export function normalizeLocalSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export async function searchLocalCustomers(
  scope: CounterPosScope,
  query: string,
  limit = 20,
): Promise<CustomerDto[]> {
  const needle = normalizeLocalSearch(query);
  if (!needle) return [];
  const result = await runStorage(scope?.organizationId ?? "", async (db) => {
    assertScope(scope);
    return db.customers.where("organizationId").equals(scope.organizationId).toArray();
  });
  if (!result.ok) return [];
  return result.value
    .filter((record) => record.status === "ACTIVE")
    .filter((record) =>
      normalizeLocalSearch(
        `${record.name} ${record.code} ${record.displayCode} ${customerAccountNumber(record.code)} ${record.phone ?? ""}`,
      ).includes(needle),
    )
    .sort((a, b) => a.name.localeCompare(b.name, "fr"))
    .slice(0, limit)
    .map(customerDtoFromRecord);
}

/** One synchronised customer by id (restoring a saved cart's customer). */
export async function getLocalCustomer(
  scope: CounterPosScope,
  customerId: string,
): Promise<CustomerDto | null> {
  const result = await runStorage(scope?.organizationId ?? "", async (db) => {
    assertScope(scope);
    return db.customers.get([scope.organizationId, customerId]);
  });
  return result.ok && result.value ? customerDtoFromRecord(result.value) : null;
}

export type LocalCustomerLookup =
  | { kind: "found"; customer: CustomerDto }
  | { kind: "not_found"; message: string }
  | { kind: "error"; message: string };

/** The "N° client" box, resolved locally (same input rules as the server). */
export async function findLocalCustomerByNumber(
  scope: CounterPosScope,
  input: string,
): Promise<LocalCustomerLookup> {
  const code = resolveCustomerCodeFromInput(input);
  if (!code) return { kind: "not_found", message: "Numéro client invalide." };
  const result = await runStorage(scope?.organizationId ?? "", async (db) => {
    assertScope(scope);
    return db.customers.where("organizationId").equals(scope.organizationId).toArray();
  });
  if (!result.ok) return { kind: "error", message: "Base locale indisponible." };
  const record = result.value.find((item) => item.code === code && item.status === "ACTIVE");
  if (!record) {
    return {
      kind: "not_found",
      message: "Client introuvable dans les données synchronisées de ce poste.",
    };
  }
  return { kind: "found", customer: customerDtoFromRecord(record) };
}
