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
 * No price is kept here: the customer never sees one. Only {productId,
 * quantity} is sent at submission and the server prices every line from the
 * database (client-portal-core.ts#submitClientOrder). Keyed by organisation +
 * customer (see cartStorageKey) so two customers on the same browser never
 * mix carts; the cart survives a reload or a page change until it is sent.
 */

type Listener = () => void;

const listenersByKey = new Map<string, Set<Listener>>();
const cacheByKey = new Map<string, ClientCartLine[]>();
const EMPTY_CART: ClientCartLine[] = [];

function clampQuantity(quantity: number) {
  return Math.min(Math.max(1, Math.trunc(quantity)), CLIENT_ORDER_MAX_QUANTITY);
}

// ---------------------------------------------------------------------------
// Pure cart rules (no storage, no React) - unit-tested directly
// ---------------------------------------------------------------------------

/**
 * A stored cart as it may come back from localStorage - including a cart saved
 * before prices were hidden (its `priceTTC` is dropped here, never shown nor sent).
 */
export function parseStoredCart(raw: string | null): ClientCartLine[] {
  if (!raw) return EMPTY_CART;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_CART;
  }
  if (!Array.isArray(parsed)) return EMPTY_CART;
  const lines: ClientCartLine[] = [];
  for (const value of parsed) {
    const line = value as Partial<ClientCartLine> | null;
    if (
      !line ||
      typeof line.productId !== "string" ||
      typeof line.productName !== "string" ||
      typeof line.quantity !== "number" ||
      !Number.isInteger(line.quantity) ||
      line.quantity < 1
    ) {
      continue;
    }
    lines.push({
      productId: line.productId,
      productName: line.productName,
      reference: typeof line.reference === "string" ? line.reference : "",
      imageUrl: typeof line.imageUrl === "string" ? line.imageUrl : null,
      quantity: Math.min(line.quantity, CLIENT_ORDER_MAX_QUANTITY),
    });
  }
  return lines;
}

/** Adds `quantity` units of a product (a new line, or more of an existing one). Null when the cart is full. */
export function addCartLine(
  cart: ClientCartLine[],
  product: Pick<ClientCatalogProductDto, "id" | "name" | "reference" | "imageUrl">,
  quantity = 1,
): ClientCartLine[] | null {
  const existing = cart.find((line) => line.productId === product.id);
  if (existing) {
    return cart.map((line) =>
      line.productId === product.id ? { ...line, quantity: clampQuantity(line.quantity + quantity) } : line,
    );
  }
  if (cart.length >= CLIENT_ORDER_MAX_LINES) return null;
  return [
    ...cart,
    {
      productId: product.id,
      productName: product.name,
      reference: product.reference,
      imageUrl: product.imageUrl,
      quantity: clampQuantity(quantity),
    },
  ];
}

/**
 * Sets a line's quantity. 0 (or less) removes the line - the card's « − » on a
 * single unit takes the product back out of the cart; never a negative quantity.
 */
export function setCartLineQuantity(cart: ClientCartLine[], productId: string, quantity: number): ClientCartLine[] {
  if (!Number.isFinite(quantity)) return cart;
  if (quantity < 1) return cart.filter((line) => line.productId !== productId);
  return cart.map((line) => (line.productId === productId ? { ...line, quantity: clampQuantity(quantity) } : line));
}

export function removeCartLines(cart: ClientCartLine[], productIds: string | string[]): ClientCartLine[] {
  const ids = new Set(Array.isArray(productIds) ? productIds : [productIds]);
  return cart.filter((line) => !ids.has(line.productId));
}

/** What the cart bar shows: the number of products and the number of units - never an amount. */
export function cartCounts(cart: ClientCartLine[]): { lineCount: number; itemCount: number } {
  return { lineCount: cart.length, itemCount: cart.reduce((sum, line) => sum + line.quantity, 0) };
}

// ---------------------------------------------------------------------------
// Storage-backed store
// ---------------------------------------------------------------------------

function readFromStorage(key: string): ClientCartLine[] {
  if (typeof window === "undefined") return EMPTY_CART;
  try {
    return parseStoredCart(window.localStorage.getItem(key));
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

export function useClientCart(key: string) {
  const cart = React.useSyncExternalStore(
    (callback) => subscribe(key, callback),
    () => getSnapshot(key),
    () => EMPTY_CART, // server snapshot: no window/localStorage during SSR.
  );

  /** Adds `quantity` units (a new line, or more of an existing one). False when the cart is full. */
  const addToCart = React.useCallback(
    (product: ClientCatalogProductDto, quantity = 1): boolean => {
      const next = addCartLine(getSnapshot(key), product, quantity);
      if (!next) return false;
      commit(key, next);
      return true;
    },
    [key],
  );

  /** 0 removes the line; the quantity is otherwise bounded to 1..CLIENT_ORDER_MAX_QUANTITY. */
  const updateQuantity = React.useCallback(
    (productId: string, quantity: number) => commit(key, setCartLineQuantity(getSnapshot(key), productId, quantity)),
    [key],
  );

  const removeFromCart = React.useCallback(
    (productIds: string | string[]) => commit(key, removeCartLines(getSnapshot(key), productIds)),
    [key],
  );

  const clearCart = React.useCallback(() => commit(key, []), [key]);

  return { cart, addToCart, updateQuantity, removeFromCart, clearCart };
}
