import type { UserRole } from "@/types/auth";

/**
 * Who may type a unit price of their own on a POS sale line (a price for THIS sale only: the
 * product's catalogue price and purchase price are never touched).
 *
 * Shared by the screens (what is offered) and by the servers (what is enforced - the counter sale
 * refuses a custom price from any other role, the driver sale is reachable by drivers only). The
 * same roles receive the product's purchase price in the POS data, which is what the cart needs
 * to colour the price (lib/pos-price-tone.ts): a role that cannot edit the price does not get the
 * cost either, so the depot manager's POS is unchanged.
 */
export const POS_LINE_PRICE_ROLES: readonly UserRole[] = ["admin", "cashier", "driver"];

export function canEditPosLinePrice(role: UserRole | null | undefined): boolean {
  return role != null && POS_LINE_PRICE_ROLES.includes(role);
}
