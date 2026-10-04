"use client";

import * as React from "react";

import type { ClientCartLine, ClientCatalogProductDto } from "@/types/client-portal";

/**
 * CLIENT PLATFORM (branch `client-platform`) - the customer catalog's cart,
 * browser-local for this V1 (no order/payment/backend persistence yet - see
 * this feature's own report). A module-level store read through
 * useSyncExternalStore, the SAME pattern already used in this project for
 * exactly this class of problem (an external, storage-backed value read into
 * React - see hooks/use-customers-store.tsx and hooks/use-company-
 * identity.tsx's own cache/listeners shape) - not a plain useState + a
 * useEffect that writes it, which both mismatches on the very first
 * server-rendered paint (localStorage does not exist server-side) and is
 * exactly what this project's own lint rule (react-hooks/set-state-in-
 * effect) flags.
 *
 * Keyed by organisation + email (see cartStorageKey below) so switching
 * accounts on the same browser never mixes carts.
 */

type Listener = () => void;

const listenersByKey = new Map<string, Set<Listener>>();
const cacheByKey = new Map<string, ClientCartLine[]>();
const EMPTY_CART: ClientCartLine[] = [];

function readFromStorage(key: string): ClientCartLine[] {
  if (typeof window === "undefined") return EMPTY_CART;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as ClientCartLine[]) : EMPTY_CART;
  } catch {
    return EMPTY_CART;
  }
}

function writeToStorage(key: string, cart: ClientCartLine[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(cart));
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

export function cartStorageKey(organizationId: string, email: string): string {
  return `comdis-client-cart:${organizationId}:${email.trim().toLowerCase()}`;
}

export function useClientCart(key: string) {
  const cart = React.useSyncExternalStore(
    (callback) => subscribe(key, callback),
    () => getSnapshot(key),
    () => EMPTY_CART, // server snapshot: no window/localStorage during SSR.
  );

  const addToCart = React.useCallback(
    (product: ClientCatalogProductDto) => {
      const current = getSnapshot(key);
      const existing = current.find((line) => line.productId === product.id);
      const next = existing
        ? current.map((line) =>
            line.productId === product.id ? { ...line, quantity: line.quantity + 1 } : line,
          )
        : [
            ...current,
            {
              productId: product.id,
              productName: product.name,
              priceTTC: product.priceTTC,
              imageUrl: product.imageUrl,
              quantity: 1,
            },
          ];
      commit(key, next);
    },
    [key],
  );

  const updateQuantity = React.useCallback(
    (productId: string, quantity: number) => {
      if (quantity < 1) return;
      commit(
        key,
        getSnapshot(key).map((line) => (line.productId === productId ? { ...line, quantity } : line)),
      );
    },
    [key],
  );

  const removeFromCart = React.useCallback(
    (productId: string) => {
      commit(
        key,
        getSnapshot(key).filter((line) => line.productId !== productId),
      );
    },
    [key],
  );

  return { cart, addToCart, updateQuantity, removeFromCart };
}
