/**
 * Which customers the DRIVER POS may list, search and look up by number:
 * ONLY the ones created by the signed-in driver (Customer.createdByDriverId,
 * set when a driver creates a customer - see createCustomerForCurrentDriver /
 * the quick-add in lib/server/driver-customers.ts).
 *
 * Pure (no `server-only`, no Prisma client) so the rule is unit-tested and
 * every server path applies the exact same filter. Customers without a
 * driver creator (created by an admin / cashier, imported, or legacy rows)
 * have createdByDriverId = null and are therefore never matched - nothing is
 * attributed to a driver by guesswork. The filter is applied in the database
 * query itself, never only in the UI.
 *
 * Not used for: the driver "Clients" page, tours, or the admin / cashier
 * screens - those keep their own rules.
 */

/** A value no driver id can ever equal: a driver session without a driver profile sees nothing. */
const NO_DRIVER = "__never__";

export function driverOwnCustomersWhere(driverId: string | null | undefined): {
  createdByDriverId: string;
} {
  return { createdByDriverId: driverId || NO_DRIVER };
}

/** In-memory twin of driverOwnCustomersWhere (same rule), handy for tests and UI guards. */
export function isCustomerOwnedByDriver(
  customer: { createdByDriverId?: string | null },
  driverId: string | null | undefined,
): boolean {
  return Boolean(driverId) && customer.createdByDriverId === driverId;
}
