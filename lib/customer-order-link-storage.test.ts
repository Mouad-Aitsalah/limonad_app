import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clearCustomerOrderLink,
  customerOrderLinkKey,
  linkAfterServerCheck,
  loadCustomerOrderLink,
  parseStoredLink,
  resolveRestoredLink,
  saveCustomerOrderLink,
  type CustomerOrderLink,
  type LinkStorage,
} from "./customer-order-link-storage";

/**
 * Cart <-> online order link across a page reload. Pure: a fake Storage, no
 * browser, no database.
 */

const scopeA = { organizationId: "org-a", userId: "user-1" };
const link: CustomerOrderLink = { id: "cmorder1", orderNumber: "CMD-000001", customerId: "cmcust1" };

function fakeStorage(initial: Record<string, string> = {}): LinkStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

test("reload: a saved link is restored for the same organisation and user", () => {
  const storage = fakeStorage();
  saveCustomerOrderLink(storage, scopeA, link);
  assert.deepEqual(loadCustomerOrderLink(storage, scopeA), link);
  assert.equal(storage.data.size, 1);
  assert.equal([...storage.data.keys()][0], customerOrderLinkKey(scopeA));
});

test("session change: another user or another organisation never sees (or inherits) the link", () => {
  const storage = fakeStorage();
  saveCustomerOrderLink(storage, scopeA, link);
  assert.equal(loadCustomerOrderLink(storage, { organizationId: "org-a", userId: "user-2" }), null);
  assert.equal(loadCustomerOrderLink(storage, { organizationId: "org-b", userId: "user-1" }), null);
  // even if a value written for A is copied under B's key, the payload's own scope is re-checked
  const raw = storage.getItem(customerOrderLinkKey(scopeA))!;
  const scopeB = { organizationId: "org-a", userId: "user-2" };
  assert.equal(parseStoredLink(raw, scopeB), null);
  const forged = fakeStorage({ [customerOrderLinkKey(scopeB)]: raw });
  assert.equal(loadCustomerOrderLink(forged, scopeB), null);
  // keys are distinct per organisation + user
  assert.notEqual(customerOrderLinkKey(scopeA), customerOrderLinkKey(scopeB));
});

test("invalid local data is ignored, never trusted: bad JSON, wrong version, bad ids, extra shapes", () => {
  const key = customerOrderLinkKey(scopeA);
  const good = { v: 1, organizationId: "org-a", userId: "user-1", link };
  for (const raw of [
    "not json",
    "null",
    "[]",
    JSON.stringify({ ...good, v: 2 }),
    JSON.stringify({ ...good, link: { ...link, id: "../../etc" } }),
    JSON.stringify({ ...good, link: { ...link, id: "" } }),
    JSON.stringify({ ...good, link: { ...link, customerId: "a b" } }),
    JSON.stringify({ ...good, link: { ...link, orderNumber: "" } }),
    JSON.stringify({ ...good, link: { ...link, orderNumber: "x".repeat(40) } }),
    JSON.stringify({ ...good, link: null }),
    JSON.stringify({ ...good, link: "cmorder1" }),
    JSON.stringify({ v: 1, link }),
  ]) {
    assert.equal(loadCustomerOrderLink(fakeStorage({ [key]: raw }), scopeA), null, raw.slice(0, 50));
  }
  assert.deepEqual(parseStoredLink(JSON.stringify({ ...good, link: { ...link, extra: "ignored" } }), scopeA), link);
});

test("blocked or full storage never throws (the link just stays in memory)", () => {
  const throwing: LinkStorage = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: () => {
      throw new Error("SecurityError");
    },
  };
  assert.equal(loadCustomerOrderLink(throwing, scopeA), null);
  assert.doesNotThrow(() => saveCustomerOrderLink(throwing, scopeA, link));
  assert.doesNotThrow(() => clearCustomerOrderLink(throwing, scopeA));
  assert.equal(loadCustomerOrderLink(null, scopeA), null);
  assert.doesNotThrow(() => saveCustomerOrderLink(undefined, scopeA, link));
});

test("the link is removed when the operation ends or the staff detaches it", () => {
  const storage = fakeStorage();
  saveCustomerOrderLink(storage, scopeA, link);
  clearCustomerOrderLink(storage, scopeA);
  assert.equal(loadCustomerOrderLink(storage, scopeA), null);
  assert.equal(storage.data.size, 0);
});

test("restoring: re-attached only to a real cart of the order's own customer", () => {
  assert.deepEqual(resolveRestoredLink(link, { cartLineCount: 2, selectedCustomerId: "cmcust1" }), { link });
  assert.deepEqual(resolveRestoredLink(link, { cartLineCount: 0, selectedCustomerId: "cmcust1" }), {
    link: null,
    dropReason: "EMPTY_CART",
  });
  assert.deepEqual(resolveRestoredLink(link, { cartLineCount: 2, selectedCustomerId: "other" }), {
    link: null,
    dropReason: "CUSTOMER_MISMATCH",
  });
  assert.deepEqual(resolveRestoredLink(link, { cartLineCount: 2, selectedCustomerId: null }), {
    link: null,
    dropReason: "CUSTOMER_MISMATCH",
  });
  assert.deepEqual(resolveRestoredLink(null, { cartLineCount: 2, selectedCustomerId: "cmcust1" }), {
    link: null,
    dropReason: "NO_LINK",
  });
});

test("server check after restoring: only a definite 'no' drops the link (never wrong association)", () => {
  assert.equal(linkAfterServerCheck(link, { status: 404 }), null);
  assert.equal(linkAfterServerCheck(link, { status: 409 }), null, "not ACCEPTED any more (rejected / already invoiced)");
  assert.equal(linkAfterServerCheck(link, { status: 200, orderId: "cmorder1", customerId: "cmcust1" }), link);
  assert.equal(linkAfterServerCheck(link, { status: 200, orderId: "cmorder2", customerId: "cmcust1" }), null, "different order");
  assert.equal(linkAfterServerCheck(link, { status: 200, orderId: "cmorder1", customerId: "cmcust2" }), null, "different customer");
  assert.equal(linkAfterServerCheck(link, { status: 200 }), null, "unreadable answer");
  // unknowns keep the link: the sale creation re-checks everything server-side
  assert.equal(linkAfterServerCheck(link, "network-error"), link);
  assert.equal(linkAfterServerCheck(link, { status: 401 }), link);
  assert.equal(linkAfterServerCheck(link, { status: 500 }), link);
});
