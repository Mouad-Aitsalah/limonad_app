"use client";

import * as React from "react";

import type { SaleInvoice } from "@/types/sale";

const STORAGE_KEY = "comdis.driverSales";
const EVENT_NAME = "comdis.driverSales.changed";
const EMPTY_SALES: SaleInvoice[] = [];
const listeners = new Set<() => void>();

let cachedRaw: string | null = null;
let cachedSales: SaleInvoice[] = EMPTY_SALES;
let hasInitialized = false;

type StoredSaleInvoice = Omit<SaleInvoice, "date"> & {
  date: string;
};

function serialize(invoice: SaleInvoice): StoredSaleInvoice {
  return { ...invoice, date: invoice.date.toISOString() };
}

function deserialize(invoice: StoredSaleInvoice): SaleInvoice {
  return { ...invoice, date: new Date(invoice.date) };
}

function initializeSalesFromStorage({ force = false } = {}) {
  if (typeof window === "undefined") return;
  if (hasInitialized && !force) return;

  hasInitialized = true;

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    cachedRaw = null;
    cachedSales = EMPTY_SALES;
    return;
  }
  if (raw === cachedRaw) return;

  try {
    const parsed = JSON.parse(raw) as StoredSaleInvoice[];
    cachedRaw = raw;
    cachedSales = parsed.map(deserialize);
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    cachedRaw = null;
    cachedSales = EMPTY_SALES;
  }
}

function getSnapshot() {
  return cachedSales;
}

function getServerSnapshot() {
  return EMPTY_SALES;
}

function notifyListeners() {
  for (const listener of listeners) {
    listener();
  }
}

function writeSales(nextSales: SaleInvoice[]) {
  const raw = JSON.stringify(nextSales.map(serialize));
  cachedRaw = raw;
  cachedSales = nextSales;
  window.localStorage.setItem(STORAGE_KEY, raw);
  window.dispatchEvent(new Event(EVENT_NAME));
  notifyListeners();
}

function subscribe(callback: () => void) {
  initializeSalesFromStorage();
  listeners.add(callback);

  function handleStorage(event: StorageEvent) {
    if (event.key !== STORAGE_KEY) return;
    initializeSalesFromStorage({ force: true });
    callback();
  }

  window.addEventListener("storage", handleStorage);

  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", handleStorage);
  };
}

export function appendDriverSale(invoice: SaleInvoice) {
  initializeSalesFromStorage();
  writeSales([invoice, ...cachedSales]);
}

export function useDriverSalesStore() {
  initializeSalesFromStorage();
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
