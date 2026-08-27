"use client";

import * as React from "react";

import { truckStock as initialTruckStock } from "@/lib/mock-data/stock";
import type { TruckStock } from "@/types/stock";

const STORAGE_KEY = "comdis.truckStock";
const EVENT_NAME = "comdis.truckStock.changed";

type StoredTruckStock = Omit<TruckStock, "lastOutboundAt" | "updatedAt"> & {
  lastOutboundAt: string | null;
  updatedAt: string;
};

const initialSnapshot = initialTruckStock;
let cachedRaw: string | null = null;
let cachedSnapshot: TruckStock[] = initialSnapshot;

function serialize(item: TruckStock): StoredTruckStock {
  return {
    ...item,
    lastOutboundAt: item.lastOutboundAt?.toISOString() ?? null,
    updatedAt: item.updatedAt.toISOString(),
  };
}

function deserialize(item: StoredTruckStock): TruckStock {
  return {
    ...item,
    lastOutboundAt: item.lastOutboundAt ? new Date(item.lastOutboundAt) : null,
    updatedAt: new Date(item.updatedAt),
  };
}

function readSnapshot(): TruckStock[] {
  if (typeof window === "undefined") return initialSnapshot;

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return initialSnapshot;
  if (raw === cachedRaw) return cachedSnapshot;

  try {
    const parsed = JSON.parse(raw) as StoredTruckStock[];
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

function writeSnapshot(items: TruckStock[]) {
  const raw = JSON.stringify(items.map(serialize));
  cachedRaw = raw;
  cachedSnapshot = items;
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

export function decreaseTruckStock(
  truckId: string,
  lines: Array<{ productId: string; quantity: number }>,
) {
  const now = new Date();
  const next = readSnapshot().map((item) => {
    const line = lines.find(
      (candidate) =>
        candidate.productId === item.productId && candidate.quantity > 0,
    );

    if (item.truckId !== truckId || !line) return item;

    return {
      ...item,
      quantity: Math.max(0, item.quantity - line.quantity),
      exits: item.exits + line.quantity,
      lastOutboundAt: now,
      updatedAt: now,
    };
  });

  writeSnapshot(next);
}

export function useTruckStockStore() {
  return React.useSyncExternalStore(subscribe, readSnapshot, () => initialSnapshot);
}
