import "server-only";

import type { CustomerOrderStatusValue } from "@/lib/client-portal-rules";
import { prisma } from "@/lib/prisma";
import { getCustomerById } from "@/lib/server/customers";
import {
  CustomerOrderError,
  getCustomerOrderDetailCore,
  getCustomerOrderForPosCore,
  listCustomerOrdersCore,
  transitionCustomerOrderCore,
} from "@/lib/server/customer-orders-core";
import { OperationsServiceError } from "@/lib/server/depots";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import { getPosProductsByIds } from "@/lib/server/products";
import type { CustomerOrderForPosDto } from "@/types/customer-order-dto";

/**
 * Staff side of the Espace Client orders ("Commandes en ligne"): the same
 * roles as the counter POS. organizationId / userId always come from the
 * staff session, never from the request.
 */

const STAFF_ROLES = ["admin", "depot_manager", "cashier"] as const;

export { CustomerOrderError };

export async function listCustomerOrders(params: { status?: CustomerOrderStatusValue | null; cursor?: string | null }) {
  const user = await requireOrganizationUser([...STAFF_ROLES]);
  return listCustomerOrdersCore(prisma, user.organizationId, params);
}

export async function getCustomerOrderDetail(orderId: string) {
  const user = await requireOrganizationUser([...STAFF_ROLES]);
  return getCustomerOrderDetailCore(prisma, user.organizationId, orderId);
}

export async function transitionCustomerOrder(orderId: string, to: "ACCEPTED" | "REJECTED", reason?: string | null) {
  const user = await requireOrganizationUser([...STAFF_ROLES]);
  return transitionCustomerOrderCore(prisma, { organizationId: user.organizationId, userId: user.id }, orderId, to, {
    reason,
  });
}

async function posStockLocationId(organizationId: string, userId: string): Promise<string> {
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId },
    select: { depotId: true, depot: { select: { active: true } } },
  });
  if (!user?.depotId || !user.depot?.active) {
    throw new OperationsServiceError("Aucun depot actif n'est associe a votre compte. Contactez un administrateur.", 409);
  }
  const location = await prisma.stockLocation.findFirst({
    where: { organizationId, depotId: user.depotId, type: "DEPOT", active: true },
    select: { id: true },
  });
  if (!location) throw new OperationsServiceError("Emplacement depot introuvable.", 404);
  return location.id;
}

/**
 * An ACCEPTED order, re-validated for the POS right now: its products still
 * sellable (loaded explicitly with their POS data, even beyond the 500
 * preloaded ones) and its customer still ACTIVE. Read-only: the order stays
 * ACCEPTED until the POS sale actually created links it (createCounterSale).
 */
export async function getCustomerOrderForPos(orderId: string): Promise<CustomerOrderForPosDto> {
  const user = await requireOrganizationUser([...STAFF_ROLES]);
  const order = await getCustomerOrderForPosCore(prisma, user.organizationId, orderId);

  const customer = await getCustomerById(order.customerId);
  if (customer.status !== "ACTIVE") {
    throw new CustomerOrderError("Le client de cette commande n'est plus actif.", 409);
  }

  const locationId = await posStockLocationId(user.organizationId, user.id);
  const products = await getPosProductsByIds({ locationId, ids: order.lines.map((line) => line.productId) });
  const sellable = new Set(products.map((product) => product.id));

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    customer,
    lines: order.lines
      .filter((line) => sellable.has(line.productId))
      .map((line) => ({ productId: line.productId, quantity: line.quantity })),
    products,
    unavailableProducts: order.lines.filter((line) => !sellable.has(line.productId)).map((line) => line.productName),
  };
}
