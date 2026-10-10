"use client";

import * as React from "react";

import { CLIENT_ORDER_MAX_LINES, CLIENT_ORDER_MAX_QUANTITY } from "@/lib/client-portal-rules";
import type { ClientCartLine, ClientCatalogProductDto } from "@/types/client-portal";

/**
 * Espace Client - the customer's cart, kept in the browser (localStorage)
 * until the order is sent. A module-level store read through
 * useSyncExternalStore, the SAME pattern already used in this project for
 * exactly this class of problem (an external, storage-backed value read into
 * React - see hooks/use-customers-store.tsx and hooks/use-company-
 * identity.tsx's own cache/listeners shape) - not a plain useState + a
 * useEffect that writes it, which both mismatches on the very first
 * server-rendered paint (localStorage does not exist server-side) and is
 * exactly what this project's own lint rule (react-hooks/set-state-in-
 * effect) flags.
 *
 * Display only: the prices kept here are what the catalogue showed; at
 * submission the server re-prices every line from the database
 * (client-portal-core.ts#submitClientOrder) and only {productId, quantity}
 * is sent. Keyed by organisation + customer (see cartStorageKey) so two
 * customers on the same browser never mix carts.
 */

type Listener = () => void;

const listenersByKey = new Map<string, Set<Listener>>();
const cacheByKey = new Map<string, ClientCartLine[]>();
const EMPTY_CART: ClientCartLine[] = [];

function isCartLine(value: unknown): value is ClientCartLine {
  const line = value as Partial<ClientCartLine> | null;
  return Boolean(
    line &&
      typeof line.productId === "string" &&
      typeof line.productName === "string" &&
      typeof line.priceTTC === "number" &&
      Number.isFinite(line.priceTTC) &&
      typeof line.quantity === "number" &&
      Number.isInteger(line.quantity) &&
      line.quantity >= 1,
  );
}

function readFromStorage(key: string): ClientCartLine[] {
  if (typeof window === "undefined") return EMPTY_CART;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return EMPTY_CART;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY_CART;
    return parsed.filter(isCartLine).map((line) => ({
      ...line,
      reference: typeof line.reference === "string" ? line.reference : "",
      imageUrl: typeof line.imageUrl === "string" ? line.imageUrl : null,
      quantity: Math.min(line.quantity, CLIENT_ORDER_MAX_QUANTITY),
    }));
  } catch {
    return EMPTY_CART;
  }
}

function writeToStorage(key: string, cart: ClientCartLine[]) {
  try {
    if (cart.length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(cart));
  } catch {
    // Storage full/unavailable (private browsing): the cart just stays in-memory.
  }
}

function getSnapshot(key: string): ClientCartLine[] {
  if (!cacheByKey.has(key)) cacheByKey.set(key, readFromStorage(key));
  return cacheByKey.get(key)!;
}

function commit(key: string, next: ClientCartLine[]) {
  cacheByKey.set(key, next);
  writeToStorage(key, next);
  for (const listener of listenersByKey.get(key) ?? []) listener();
}

function subscribe(key: string, callback: Listener): () => void {
  let listeners = listenersByKey.get(key);
  if (!listeners) {
    listeners = new Set();
    listenersByKey.set(key, listeners);
  }
  listeners.add(callback);
  return () => listeners!.delete(callback);
}

export function cartStorageKey(organizationId: string, customerId: string): string {
  return `comdis-client-cart:v2:${organizationId}:${customerId}`;
}

function clampQuantity(quantity: number) {
  return Math.min(Math.max(1, Math.trunc(quantity)), CLIENT_ORDER_MAX_QUANTITY);
}

export function useClientCart(key: string) {
  const cart = React.useSyncExternalStore(
    (callback) => subscribe(key, callback),
    () => getSnapshot(key),
    () => EMPTY_CART, // server snapshot: no window/localStorage during SSR.
  );

  /** Adds `quantity` units (a new line, or more of an existing one). False when the cart is full. */
  const addToCart = React.useCallback(
    (product: ClientCatalogProductDto, quantity = 1): boolean => {
      const current = getSnapshot(key);
      const existing = current.find((line) => line.productId === product.id);
      if (!existing && current.length >= CLIENT_ORDER_MAX_LINES) return false;
      const next = existing
        ? current.map((line) =>
            line.productId === product.id
              ? { ...line, priceTTC: product.priceTTC, quantity: clampQuantity(line.quantity + quantity) }
              : line,
          )
        : [
            ...current,
            {
              productId: product.id,
              productName: product.name,
              reference: product.reference,
              priceTTC: product.priceTTC,
              imageUrl: product.imageUrl,
              quantity: clampQuantity(quantity),
            },
          ];
      commit(key, next);
      return true;
    },
    [key],
  );

  const updateQuantity = React.useCallback(
    (productId: string, quantity: number) => {
      if (!Number.isFinite(quantity) || quantity < 1) return;
      commit(
        key,
        getSnapshot(key).map((line) =>
          line.productId === productId ? { ...line, quantity: clampQuantity(quantity) } : line,
        ),
      );
    },
    [key],
  );

  const removeFromCart = React.useCallback(
    (productIds: string | string[]) => {
      const ids = new Set(Array.isArray(productIds) ? productIds : [productIds]);
      commit(
        key,
        getSnapshot(key).filter((line) => !ids.has(line.productId)),
      );
    },
    [key],
  );

  /** Applies the server's current prices (after a PRICE_CHANGED answer). */
  const applyPrices = React.useCallback(
    (prices: Array<{ productId: string; priceTTC: number }>) => {
      const byId = new Map(prices.map((price) => [price.productId, price.priceTTC]));
      commit(
        key,
        getSnapshot(key).map((line) =>
          byId.has(line.productId) ? { ...line, priceTTC: byId.get(line.productId)! } : line,
        ),
      );
    },
    [key],
  );

  const clearCart = React.useCallback(() => commit(key, []), [key]);

  return { cart, addToCart, updateQuantity, removeFromCart, applyPrices, clearCart };
}
