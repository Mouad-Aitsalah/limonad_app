import type { Prisma, PrismaClient } from "@/lib/generated/prisma/client";
import { canOpenInPos, canStaffTransition, isInvoicePending, type CustomerOrderStatusValue } from "@/lib/client-portal-rules";
import { formatCustomerCode } from "@/lib/customer-code";
import type {
  CustomerOrderDetailDto,
  CustomerOrderListItemDto,
  CustomerOrdersPageDto,
} from "@/types/customer-order-dto";

/**
 * Internal handling of the Espace Client orders, with an explicit
 * organisation / user scope and database handle (no session read, no
 * server-only import) so it is tested against a real rolled-back database.
 * The session wrapper is lib/server/customer-orders.ts.
 *
 * Accept / reject only change the order's status. Nothing here creates a
 * Sale, Payment, StockMovement or AccountingEntry: CONVERTED is set only by
 * the POS sale creation (linkCustomerOrderToSale, same transaction).
 */

export type CustomerOrdersDb = PrismaClient | Prisma.TransactionClient;

export class CustomerOrderError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "CustomerOrderError";
  }
}

const listSelect = {
  id: true,
  orderNumber: true,
  status: true,
  contactPhone: true,
  totalTTC: true,
  createdAt: true,
  processedAt: true,
  convertedSaleId: true,
  // Only to tell "Facture en attente" (linked sale still DRAFT) from "Facturée".
  convertedSale: { select: { status: true } },
  customer: { select: { id: true, name: true, code: true } },
  processedBy: { select: { fullName: true } },
  lines: { select: { quantity: true } },
} as const;

type ListRow = Prisma.CustomerOrderGetPayload<{ select: typeof listSelect }>;

function toListItem(row: ListRow): CustomerOrderListItemDto {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    customer: { id: row.customer.id, name: row.customer.name, displayCode: formatCustomerCode(row.customer.code) },
    contactPhone: row.contactPhone,
    itemCount: row.lines.reduce((sum, line) => sum + line.quantity, 0),
    totalTTC: Number(row.totalTTC),
    createdAt: row.createdAt.toISOString(),
    processedAt: row.processedAt?.toISOString() ?? null,
    processedByName: row.processedBy?.fullName ?? null,
    convertedSaleId: row.convertedSaleId,
    invoicePending: isInvoicePending(row.status, row.convertedSale?.status),
  };
}

const PAGE_SIZE = 25;

export async function listCustomerOrdersCore(
  db: CustomerOrdersDb,
  organizationId: string,
  params: { status?: CustomerOrderStatusValue | null; cursor?: string | null } = {},
): Promise<CustomerOrdersPageDto> {
  const rows = await db.customerOrder.findMany({
    where: { organizationId, ...(params.status ? { status: params.status } : {}) },
    select: listSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  return { items: page.map(toListItem), nextCursor: hasMore ? page[page.length - 1].id : null };
}

export async function getCustomerOrderDetailCore(
  db: CustomerOrdersDb,
  organizationId: string,
  orderId: string,
): Promise<CustomerOrderDetailDto> {
  const row = await db.customerOrder.findFirst({
    where: { id: orderId, organizationId },
    select: {
      ...listSelect,
      note: true,
      rejectionReason: true,
      subtotalHT: true,
      taxAmount: true,
      roundingAmount: true,
      lines: {
        select: {
          productId: true,
          productName: true,
          productReference: true,
          quantity: true,
          unitPriceHT: true,
          taxRate: true,
          totalTTC: true,
        },
        orderBy: { productName: "asc" },
      },
    },
  });
  if (!row) throw new CustomerOrderError("Commande introuvable.", 404);
  return {
    ...toListItem(row),
    note: row.note,
    rejectionReason: row.rejectionReason,
    subtotalHT: Number(row.subtotalHT),
    taxAmount: Number(row.taxAmount),
    roundingAmount: Number(row.roundingAmount),
    lines: row.lines.map((line) => ({
      productId: line.productId,
      productName: line.productName,
      productReference: line.productReference,
      quantity: line.quantity,
      unitPriceHT: Number(line.unitPriceHT),
      taxRate: Number(line.taxRate),
      totalTTC: Number(line.totalTTC),
    })),
  };
}

/**
 * Accept or reject an order. Guarded on the CURRENT status in the update
 * itself, so two people acting at the same time can never both succeed, and
 * an order already CONVERTED/REJECTED is never changed.
 */
export async function transitionCustomerOrderCore(
  db: CustomerOrdersDb,
  scope: { organizationId: string; userId: string },
  orderId: string,
  to: "ACCEPTED" | "REJECTED",
  options: { reason?: string | null; now?: Date } = {},
): Promise<CustomerOrderDetailDto> {
  const current = await db.customerOrder.findFirst({
    where: { id: orderId, organizationId: scope.organizationId },
    select: { status: true },
  });
  if (!current) throw new CustomerOrderError("Commande introuvable.", 404);
  if (!canStaffTransition(current.status, to)) {
    throw new CustomerOrderError("Cette commande ne peut plus être modifiée dans son état actuel.", 409);
  }

  const now = options.now ?? new Date();
  const reason = to === "REJECTED" ? options.reason?.trim().slice(0, 500) || null : null;
  const { count } = await db.customerOrder.updateMany({
    where: { id: orderId, organizationId: scope.organizationId, status: current.status },
    data: {
      status: to,
      processedByUserId: scope.userId,
      processedAt: now,
      ...(to === "REJECTED" ? { rejectionReason: reason } : {}),
    },
  });
  if (count !== 1) {
    throw new CustomerOrderError("Cette commande vient d'être modifiée par quelqu'un d'autre. Rechargez la page.", 409);
  }

  await db.auditLog.create({
    data: {
      organizationId: scope.organizationId,
      userId: scope.userId,
      action: to === "ACCEPTED" ? "CUSTOMER_ORDER_ACCEPTED" : "CUSTOMER_ORDER_REJECTED",
      entityType: "CustomerOrder",
      entityId: orderId,
      oldValue: { status: current.status },
      newValue: { status: to, ...(reason ? { reason } : {}) },
    },
  });
  return getCustomerOrderDetailCore(db, scope.organizationId, orderId);
}

/** An order the POS may open: ACCEPTED, of this organisation, with its customer and lines. */
export async function getCustomerOrderForPosCore(db: CustomerOrdersDb, organizationId: string, orderId: string) {
  const order = await db.customerOrder.findFirst({
    where: { id: orderId, organizationId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      customerId: true,
      lines: { select: { productId: true, productName: true, quantity: true } },
    },
  });
  if (!order) throw new CustomerOrderError("Commande introuvable.", 404);
  if (!canOpenInPos(order.status)) {
    throw new CustomerOrderError(
      order.status === "CONVERTED"
        ? "Cette commande a déjà été facturée."
        : "Seule une commande acceptée peut être ouverte dans le POS.",
      409,
    );
  }
  return order;
}

export type LinkCustomerOrderResult =
  | { ok: true }
  | { ok: false; reason: "NOT_FOUND" | "NOT_ACCEPTED" | "CUSTOMER_MISMATCH" | "ALREADY_CONVERTED" };

/**
 * Called by createCounterSale INSIDE the sale's transaction, right after the
 * sale row is created: marks the ACCEPTED order CONVERTED and links it to the
 * sale. The update is guarded on (status ACCEPTED, not yet linked, same
 * customer), so the same order can never be invoiced twice even by two
 * tills at once; any failure makes the caller roll the whole sale back.
 * The conversion is written to the audit log in the same transaction (the
 * counterpart of CUSTOMER_ORDER_REOPENED), so it rolls back with the sale.
 */
export async function linkCustomerOrderToSale(
  tx: CustomerOrdersDb,
  params: {
    organizationId: string;
    customerOrderId: string;
    saleId: string;
    saleCustomerId: string | null;
    userId: string;
    saleInvoiceNumber?: string;
    now?: Date;
  },
): Promise<LinkCustomerOrderResult> {
  const order = await tx.customerOrder.findFirst({
    where: { id: params.customerOrderId, organizationId: params.organizationId },
    select: { status: true, customerId: true, convertedSaleId: true, orderNumber: true },
  });
  if (!order) return { ok: false, reason: "NOT_FOUND" };
  if (order.convertedSaleId || order.status === "CONVERTED") return { ok: false, reason: "ALREADY_CONVERTED" };
  if (order.status !== "ACCEPTED") return { ok: false, reason: "NOT_ACCEPTED" };
  if (order.customerId !== params.saleCustomerId) return { ok: false, reason: "CUSTOMER_MISMATCH" };

  const { count } = await tx.customerOrder.updateMany({
    where: {
      id: params.customerOrderId,
      organizationId: params.organizationId,
      status: "ACCEPTED",
      convertedSaleId: null,
      customerId: params.saleCustomerId,
    },
    data: { status: "CONVERTED", convertedSaleId: params.saleId, convertedAt: params.now ?? new Date() },
  });
  if (count !== 1) return { ok: false, reason: "ALREADY_CONVERTED" };

  await tx.auditLog.create({
    data: {
      organizationId: params.organizationId,
      userId: params.userId,
      action: "CUSTOMER_ORDER_CONVERTED",
      entityType: "CustomerOrder",
      entityId: params.customerOrderId,
      oldValue: { status: "ACCEPTED" },
      newValue: {
        status: "CONVERTED",
        saleId: params.saleId,
        orderNumber: order.orderNumber,
        ...(params.saleInvoiceNumber ? { saleInvoiceNumber: params.saleInvoiceNumber } : {}),
      },
    },
  });
  return { ok: true };
}

/**
 * Called by cancelSale INSIDE the cancellation transaction: when the cancelled
 * sale is exactly the one an online order was converted into, the order goes
 * back to ACCEPTED (convertedSaleId / convertedAt cleared) so it can be opened
 * in the POS and invoiced again, and the event is written to the audit log.
 * The update is guarded on (this organisation, status CONVERTED, convertedSaleId
 * = THIS sale): an order converted into another sale, or already released, is
 * never touched. The cancelled sale itself is not modified here at all.
 */
export async function releaseCustomerOrderForCancelledSale(
  tx: CustomerOrdersDb,
  params: { organizationId: string; saleId: string; userId: string; saleInvoiceNumber?: string },
): Promise<{ released: boolean; orderId?: string }> {
  const order = await tx.customerOrder.findFirst({
    where: { organizationId: params.organizationId, convertedSaleId: params.saleId, status: "CONVERTED" },
    select: { id: true, orderNumber: true },
  });
  if (!order) return { released: false };

  const { count } = await tx.customerOrder.updateMany({
    where: { id: order.id, organizationId: params.organizationId, status: "CONVERTED", convertedSaleId: params.saleId },
    data: { status: "ACCEPTED", convertedSaleId: null, convertedAt: null },
  });
  if (count !== 1) return { released: false };

  await tx.auditLog.create({
    data: {
      organizationId: params.organizationId,
      userId: params.userId,
      action: "CUSTOMER_ORDER_REOPENED",
      entityType: "CustomerOrder",
      entityId: order.id,
      oldValue: { status: "CONVERTED", convertedSaleId: params.saleId },
      newValue: {
        status: "ACCEPTED",
        reason: "SALE_CANCELLED",
        orderNumber: order.orderNumber,
        ...(params.saleInvoiceNumber ? { saleInvoiceNumber: params.saleInvoiceNumber } : {}),
      },
    },
  });
  return { released: true, orderId: order.id };
}

export const LINK_CUSTOMER_ORDER_MESSAGES: Record<Exclude<LinkCustomerOrderResult, { ok: true }>["reason"], string> = {
  NOT_FOUND: "La commande en ligne liée à ce panier est introuvable.",
  NOT_ACCEPTED: "La commande en ligne liée à ce panier n'est plus acceptée (refusée ou modifiée).",
  CUSTOMER_MISMATCH: "Le client de la facture doit être celui de la commande en ligne.",
  ALREADY_CONVERTED: "Cette commande en ligne a déjà été facturée.",
};
