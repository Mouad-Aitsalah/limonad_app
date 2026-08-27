"use client";

import * as React from "react";

import { customers as initialCustomers } from "@/lib/mock-data/customers";
import type { Customer } from "@/types/customer";

const STORAGE_KEY = "comdis.customers";
const EVENT_NAME = "comdis.customers.changed";

type StoredCustomer = Omit<Customer, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

const initialSnapshot = initialCustomers;
let cachedRaw: string | null = null;
let cachedSnapshot: Customer[] = initialSnapshot;

function serialize(customer: Customer): StoredCustomer {
  return {
    ...customer,
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString(),
  };
}

function deserialize(customer: StoredCustomer): Customer {
  return {
    ...customer,
    createdAt: new Date(customer.createdAt),
    updatedAt: new Date(customer.updatedAt),
  };
}

function readSnapshot(): Customer[] {
  if (typeof window === "undefined") return initialSnapshot;

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return initialSnapshot;
  if (raw === cachedRaw) return cachedSnapshot;

  try {
    const parsed = JSON.parse(raw) as StoredCustomer[];
    cachedRaw = raw;
    cachedSnapshot = parsed.map(deserialize);
    return cachedSnapshot;
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    cachedRaw = null;
    cachedSnapshot = initialSnapshot;
    return initialSnapshot;
  }
}

function writeSnapshot(customers: Customer[]) {
  const raw = JSON.stringify(customers.map(serialize));
  cachedRaw = raw;
  cachedSnapshot = customers;
  window.localStorage.setItem(STORAGE_KEY, raw);
  window.dispatchEvent(new Event(EVENT_NAME));
}

function subscribe(callback: () => void) {
  window.addEventListener(EVENT_NAME, callback);
  window.addEventListener("storage", callback);

  return () => {
    window.removeEventListener(EVENT_NAME, callback);
    window.removeEventListener("storage", callback);
  };
}

export function upsertCustomer(customer: Customer) {
  const current = readSnapshot();
  const exists = current.some((item) => item.id === customer.id);
  const next = exists
    ? current.map((item) => (item.id === customer.id ? customer : item))
    : [customer, ...current];
  writeSnapshot(next);
}

export function useCustomersStore() {
  return React.useSyncExternalStore(subscribe, readSnapshot, () => initialSnapshot);
}
