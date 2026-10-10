/**
 * Keeps the link "POS cart <-> online customer order" across a page reload.
 *
 * The cart itself is restored from IndexedDB, but the link used to live in
 * React state only: after a reload the restored cart no longer carried
 * customerOrderId, so validating it created a normal invoice while the order
 * stayed ACCEPTED (and could be invoiced a second time).
 *
 * Isomorphic and storage-injected (no `window`, no server-only import) so the
 * rules are unit-tested. The key is isolated by organisation AND user, the
 * stored value repeats both and is re-checked on read, and a stored link is
 * only ever restored together with a cart that is really there and for the
 * same customer - anything else is dropped, never guessed.
 */

export type CustomerOrderLink = {
  id: string;
  orderNumber: string;
  customerId: string;
};

export type LinkScope = { organizationId: string; userId: string };

/** The subset of the Web Storage API used here (a fake in the tests). */
export type LinkStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const KEY_PREFIX = "comdis-pos-customer-order-link:v1";
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function customerOrderLinkKey(scope: LinkScope): string {
  return `${KEY_PREFIX}:${scope.organizationId}:${scope.userId}`;
}

function isLink(value: unknown): value is CustomerOrderLink {
  const link = value as Partial<CustomerOrderLink> | null;
  return Boolean(
    link &&
      typeof link.id === "string" &&
      ID_PATTERN.test(link.id) &&
      typeof link.customerId === "string" &&
      ID_PATTERN.test(link.customerId) &&
      typeof link.orderNumber === "string" &&
      link.orderNumber.length > 0 &&
      link.orderNumber.length <= 32,
  );
}

/** Parses a stored value; anything malformed, or written for another organisation/user, is null. */
export function parseStoredLink(raw: string | null | undefined, scope: LinkScope): CustomerOrderLink | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { v?: unknown; organizationId?: unknown; userId?: unknown; link?: unknown };
    if (parsed.v !== 1 || parsed.organizationId !== scope.organizationId || parsed.userId !== scope.userId) return null;
    return isLink(parsed.link)
      ? { id: parsed.link.id, orderNumber: parsed.link.orderNumber, customerId: parsed.link.customerId }
      : null;
  } catch {
    return null;
  }
}

export function loadCustomerOrderLink(storage: LinkStorage | null | undefined, scope: LinkScope): CustomerOrderLink | null {
  if (!storage) return null;
  try {
    return parseStoredLink(storage.getItem(customerOrderLinkKey(scope)), scope);
  } catch {
    return null; // storage blocked / unavailable
  }
}

export function saveCustomerOrderLink(storage: LinkStorage | null | undefined, scope: LinkScope, link: CustomerOrderLink): void {
  if (!storage) return;
  try {
    storage.setItem(
      customerOrderLinkKey(scope),
      JSON.stringify({ v: 1, organizationId: scope.organizationId, userId: scope.userId, link }),
    );
  } catch {
    // storage full / blocked: the link just stays in memory for this page
  }
}

export function clearCustomerOrderLink(storage: LinkStorage | null | undefined, scope: LinkScope): void {
  if (!storage) return;
  try {
    storage.removeItem(customerOrderLinkKey(scope));
  } catch {
    // nothing to do
  }
}

/**
 * Decides whether a stored link may be re-attached to the cart that was just
 * restored: there must be a cart (a link without products is meaningless) and
 * its customer must be the order's customer. Otherwise the link is dropped.
 */
export function resolveRestoredLink(
  stored: CustomerOrderLink | null,
  restored: { cartLineCount: number; selectedCustomerId: string | null },
): { link: CustomerOrderLink | null; dropReason?: "NO_LINK" | "EMPTY_CART" | "CUSTOMER_MISMATCH" } {
  if (!stored) return { link: null, dropReason: "NO_LINK" };
  if (restored.cartLineCount === 0) return { link: null, dropReason: "EMPTY_CART" };
  if (restored.selectedCustomerId !== stored.customerId) return { link: null, dropReason: "CUSTOMER_MISMATCH" };
  return { link: stored };
}

/**
 * What to do with a restored link once the server was asked whether the order
 * can still be opened (GET /api/customer-orders/[id]/pos). Only a definite
 * "no" (not found / not ACCEPTED any more / other customer) drops the link;
 * an expired session, a network failure or a server error keep it - the sale
 * creation re-checks everything server-side and refuses (409) anyway.
 */
export function linkAfterServerCheck(
  link: CustomerOrderLink,
  answer: { status: number; orderId?: string; customerId?: string } | "network-error",
): CustomerOrderLink | null {
  if (answer === "network-error") return link;
  if (answer.status === 404 || answer.status === 409) return null;
  if (answer.status >= 200 && answer.status < 300) {
    return answer.orderId === link.id && answer.customerId === link.customerId ? link : null;
  }
  return link;
}
