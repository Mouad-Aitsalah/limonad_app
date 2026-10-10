import { Prisma, type PrismaClient } from "@/lib/generated/prisma/client";
import {
  CLIENT_CATALOG_PAGE_SIZE,
  CLIENT_LOGIN_MAX_FAILURES_PER_IP,
  CLIENT_LOGIN_MAX_FAILURES_PER_ORG,
  CLIENT_LOGIN_RETENTION_MS,
  CLIENT_LOGIN_WINDOW_MS,
  CLIENT_ORDER_MAX_PER_HOUR,
  VALID_PHOTO_PREFIXES,
  clientOrderInputSchema,
  computeClientOrderTotals,
  customerCodeCandidates,
  isInvoicePending,
  isValidProductPhoto,
  mergeOrderLines,
  organizationCodeCandidates,
  totalsDiffer,
  type CustomerOrderStatusValue,
} from "@/lib/client-portal-rules";
import { formatCustomerCode } from "@/lib/customer-code";
import { computePriceTTC } from "@/lib/product-pricing";
import type {
  ClientCatalogCategoryDto,
  ClientCatalogPageDto,
  ClientCatalogProductDto,
  ClientOrderSummaryDto,
} from "@/types/client-portal";

/**
 * Espace Client - the database logic, with an EXPLICIT scope and database
 * handle: no session read and no server-only import, so the very same code is
 * exercised against a real (rolled-back) database in the tests. Callers
 * (lib/server/client-auth.ts, the /api/client/* routes) pass the scope taken
 * from the verified client session only - never from the request.
 *
 * Nothing here ever writes a Sale, Payment, StockMovement, StockLevel or
 * AccountingEntry: the only writes are ClientLoginAttempt (throttle),
 * CustomerOrder + its lines and an AuditLog row.
 */

export type ClientPortalDb = PrismaClient | Prisma.TransactionClient;

export class ClientPortalError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ClientPortalError";
  }
}

export type ClientScope = {
  organizationId: string;
  customerId: string;
  contactPhone: string | null;
};

export type ClientIdentity = {
  organizationId: string;
  organizationCode: string;
  customerId: string;
  customerName: string;
  customerDisplayCode: string;
};

async function inTransaction<T>(db: ClientPortalDb, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  if (!("$transaction" in db)) return run(db);
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await db.$transaction(run, { isolationLevel: "Serializable", timeout: 20_000 });
    } catch (error) {
      const code = (error as { code?: string; message?: string }).code;
      const message = (error as { message?: string }).message ?? "";
      const retryable = code === "P2034" || (code === "P2010" && /40001|40P01/.test(message));
      if (!retryable || attempt >= 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * attempt));
    }
  }
}

// ---------------------------------------------------------------------------
// Login + throttle
// ---------------------------------------------------------------------------

async function recentFailures(db: ClientPortalDb, key: string, now: Date): Promise<number> {
  return db.clientLoginAttempt.count({
    where: { key, createdAt: { gt: new Date(now.getTime() - CLIENT_LOGIN_WINDOW_MS) } },
  });
}

/**
 * Writes ONE audit row per blocked key per throttle window ("CLIENT_LOGIN_THROTTLED"),
 * so the supplier can see a lockout or an attack without a flood of blocked
 * attempts filling the log. Only the throttle facts are stored: the scope,
 * the failure count, the IP and the organisation code that was typed -
 * never a customer code, a phone number or any other credential. Best-effort:
 * a failure to write the log never changes the answer.
 */
async function auditClientLoginThrottled(
  db: ClientPortalDb,
  params: {
    organizationCode: string;
    ip: string;
    blockedBy: Array<{ scope: "IP" | "ORGANIZATION"; key: string; failures: number }>;
    now: Date;
  },
): Promise<void> {
  try {
    const since = new Date(params.now.getTime() - CLIENT_LOGIN_WINDOW_MS);
    const organization = await db.organization.findFirst({
      where: { code: { in: organizationCodeCandidates(params.organizationCode) } },
      select: { id: true },
    });
    for (const blocked of params.blockedBy) {
      const alreadyLogged = await db.auditLog.findFirst({
        where: { action: "CLIENT_LOGIN_THROTTLED", entityType: "ClientLogin", entityId: blocked.key, createdAt: { gt: since } },
        select: { id: true },
      });
      if (alreadyLogged) continue;
      await db.auditLog.create({
        data: {
          organizationId: organization?.id ?? null,
          userId: null,
          action: "CLIENT_LOGIN_THROTTLED",
          entityType: "ClientLogin",
          entityId: blocked.key,
          newValue: {
            scope: blocked.scope,
            failuresInWindow: blocked.failures,
            windowMinutes: CLIENT_LOGIN_WINDOW_MS / 60_000,
            organizationCode: params.organizationCode.trim().toUpperCase().slice(0, 64),
          },
          ipAddress: params.ip,
        },
      });
    }
  } catch {
    // never let the audit trail change the login answer
  }
}

/**
 * Checks {organizationCode, customerCode} against an ACTIVE organisation and
 * one of its ACTIVE customers. Every failure gives the same answer (INVALID)
 * so the endpoint never reveals which code was wrong; failures are counted
 * per IP and per organisation code in the database (shared by every server
 * instance) and a tripped key answers THROTTLED without even checking.
 */
export async function authenticateClient(
  db: ClientPortalDb,
  input: { organizationCode: string; customerCode: string },
  meta: { ip: string; now?: Date },
): Promise<{ ok: true; identity: ClientIdentity } | { ok: false; reason: "INVALID" | "THROTTLED" }> {
  const now = meta.now ?? new Date();
  const orgKey = `org:${input.organizationCode.trim().toUpperCase().slice(0, 64)}`;
  const ipKey = `ip:${meta.ip}`;

  // Opportunistic purge, then the throttle check BEFORE any credential lookup.
  await db.clientLoginAttempt.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - CLIENT_LOGIN_RETENTION_MS) } },
  });
  const [ipFailures, orgFailures] = await Promise.all([recentFailures(db, ipKey, now), recentFailures(db, orgKey, now)]);
  const ipBlocked = ipFailures >= CLIENT_LOGIN_MAX_FAILURES_PER_IP;
  const orgBlocked = orgFailures >= CLIENT_LOGIN_MAX_FAILURES_PER_ORG;
  if (ipBlocked || orgBlocked) {
    await auditClientLoginThrottled(db, {
      organizationCode: input.organizationCode,
      ip: meta.ip,
      blockedBy: [ipBlocked ? { scope: "IP" as const, key: ipKey, failures: ipFailures } : null, orgBlocked ? { scope: "ORGANIZATION" as const, key: orgKey, failures: orgFailures } : null].filter((item) => item !== null),
      now,
    });
    return { ok: false, reason: "THROTTLED" };
  }

  const organization = await db.organization.findFirst({
    where: { code: { in: organizationCodeCandidates(input.organizationCode) }, status: "ACTIVE" },
    select: { id: true, code: true },
  });
  const customer = organization
    ? await db.customer.findFirst({
        where: {
          organizationId: organization.id,
          code: { in: customerCodeCandidates(input.customerCode) },
          status: "ACTIVE",
        },
        select: { id: true, name: true, code: true },
      })
    : null;

  if (!organization || !customer) {
    await db.clientLoginAttempt.createMany({ data: [{ key: ipKey }, { key: orgKey }] });
    return { ok: false, reason: "INVALID" };
  }

  // A successful login clears this IP's own failures (not the organisation's).
  await db.clientLoginAttempt.deleteMany({ where: { key: ipKey } });
  return {
    ok: true,
    identity: {
      organizationId: organization.id,
      organizationCode: organization.code,
      customerId: customer.id,
      customerName: customer.name,
      customerDisplayCode: formatCustomerCode(customer.code),
    },
  };
}

/** The session's organisation and customer, both still ACTIVE and still linked - else null. */
export async function resolveClientIdentity(
  db: ClientPortalDb,
  claims: { organizationId: string; customerId: string },
): Promise<ClientIdentity | null> {
  const customer = await db.customer.findFirst({
    where: {
      id: claims.customerId,
      organizationId: claims.organizationId,
      status: "ACTIVE",
      organization: { status: "ACTIVE" },
    },
    select: { id: true, name: true, code: true, organization: { select: { id: true, code: true } } },
  });
  if (!customer) return null;
  return {
    organizationId: customer.organization.id,
    organizationCode: customer.organization.code,
    customerId: customer.id,
    customerName: customer.name,
    customerDisplayCode: formatCustomerCode(customer.code),
  };
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

/** SQL: the product has a stored photo with an accepted prefix (refined by isValidProductPhoto). */
function photoPrefixSql(column: Prisma.Sql) {
  return Prisma.join(
    VALID_PHOTO_PREFIXES.map((prefix) => Prisma.sql`lower(left(${column}, ${prefix.length})) = ${prefix}`),
    " OR ",
  );
}

type CatalogRow = {
  id: string;
  name: string;
  reference: string;
  description: string | null;
  categoryId: string;
  categoryName: string;
  salePrice: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  updatedAt: Date;
  // A data: photo is only fetched as its first 120 characters + its length -
  // never the whole (up to ~2.7 MB) base64 for every row of a page.
  imageHead: string;
  imageLength: number;
};

/** Enough of a stored photo to validate it without loading a whole base64 image. */
function photoIsValid(row: Pick<CatalogRow, "imageHead" | "imageLength">): boolean {
  if (row.imageHead.toLowerCase().startsWith("data:")) {
    // isValidProductPhoto on the head (prefix + base64 charset) and a real payload length.
    const prefix = VALID_PHOTO_PREFIXES.find((candidate) => row.imageHead.toLowerCase().startsWith(candidate));
    return Boolean(prefix) && Number(row.imageLength) >= prefix!.length + 16 && isValidProductPhoto(row.imageHead);
  }
  return isValidProductPhoto(row.imageHead);
}

function clientPhotoUrl(row: Pick<CatalogRow, "id" | "imageHead" | "updatedAt">): string {
  // Same lightweight rule as the staff screens (toLightweightProductImageUrl):
  // a stored data: image is served by GET /api/products/[id]/image, an
  // external URL is passed through.
  return row.imageHead.toLowerCase().startsWith("data:")
    ? `/api/products/${row.id}/image?v=${row.updatedAt.getTime()}`
    : row.imageHead;
}

const eligibleProductSql = (organizationId: string) => Prisma.sql`
  p."organizationId" = ${organizationId}
  AND p.status = 'ACTIVE'
  AND p."imageUrl" IS NOT NULL
  AND (${photoPrefixSql(Prisma.sql`p."imageUrl"`)})
`;

async function availabilityFor(db: ClientPortalDb, organizationId: string, productIds: string[]) {
  if (productIds.length === 0) return new Map<string, boolean>();
  // Depots only (never trucks), ACTIVE locations, never the raw quantity.
  const rows = await db.$queryRaw<Array<{ productId: string; available: boolean }>>(Prisma.sql`
    SELECT sl."productId" AS "productId", (SUM(sl.quantity - sl."reservedQuantity") > 0) AS available
    FROM "StockLevel" sl
    JOIN "StockLocation" loc ON loc.id = sl."locationId"
    WHERE sl."organizationId" = ${organizationId}
      AND loc."organizationId" = ${organizationId}
      AND loc.type = 'DEPOT'
      AND loc.active = true
      AND sl."productId" IN (${Prisma.join(productIds)})
    GROUP BY sl."productId"
  `);
  return new Map(rows.map((row) => [row.productId, Boolean(row.available)]));
}

/**
 * One page of the catalogue: ACTIVE products of the organisation that have a
 * valid photo, filtered (search, category) and paginated IN THE DATABASE -
 * the browser never receives the whole catalogue to filter it. Cursor =
 * the last product id of the previous page (order: name, id).
 */
export async function getClientCatalogPage(
  db: ClientPortalDb,
  organizationId: string,
  params: { q?: string; categoryId?: string; cursor?: string | null; limit?: number } = {},
): Promise<ClientCatalogPageDto> {
  const limit = Math.min(Math.max(1, Math.trunc(params.limit ?? CLIENT_CATALOG_PAGE_SIZE)), 100);
  const q = params.q?.trim().slice(0, 100) || null;
  const categoryId = params.categoryId?.trim() || null;

  let cursorRow: { name: string; id: string } | null = null;
  if (params.cursor) {
    cursorRow = await db.product.findFirst({
      where: { id: params.cursor, organizationId },
      select: { name: true, id: true },
    });
  }

  const rows = await db.$queryRaw<CatalogRow[]>(Prisma.sql`
    SELECT p.id, p.name, p.reference, p.description, p."categoryId", c.name AS "categoryName",
           p."salePrice", p."taxRate", p."updatedAt",
           CASE WHEN lower(left(p."imageUrl", 5)) = 'data:' THEN left(p."imageUrl", 120) ELSE p."imageUrl" END AS "imageHead",
           length(p."imageUrl")::int AS "imageLength"
    FROM "Product" p
    JOIN "Category" c ON c.id = p."categoryId"
    WHERE ${eligibleProductSql(organizationId)}
      ${q ? Prisma.sql`AND (p.name ILIKE ${`%${q}%`} OR p.reference ILIKE ${`%${q}%`} OR p.barcode = ${q})` : Prisma.empty}
      ${categoryId ? Prisma.sql`AND p."categoryId" = ${categoryId}` : Prisma.empty}
      ${cursorRow ? Prisma.sql`AND (p.name, p.id) > (${cursorRow.name}, ${cursorRow.id})` : Prisma.empty}
    ORDER BY p.name ASC, p.id ASC
    LIMIT ${limit + 1}
  `);

  const pageRows = rows.slice(0, limit).filter(photoIsValid);
  const availability = await availabilityFor(db, organizationId, pageRows.map((row) => row.id));
  const products: ClientCatalogProductDto[] = pageRows.map((row) => ({
    id: row.id,
    name: row.name,
    reference: row.reference,
    description: row.description,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    priceTTC: computePriceTTC(Number(row.salePrice), Number(row.taxRate)),
    imageUrl: clientPhotoUrl(row),
    available: availability.get(row.id) ?? false,
  }));
  return { products, nextCursor: rows.length > limit ? rows[limit - 1].id : null };
}

/** Categories that contain at least one catalogue product. */
export async function getClientCatalogCategories(
  db: ClientPortalDb,
  organizationId: string,
): Promise<ClientCatalogCategoryDto[]> {
  return db.$queryRaw<ClientCatalogCategoryDto[]>(Prisma.sql`
    SELECT DISTINCT c.id, c.name
    FROM "Product" p
    JOIN "Category" c ON c.id = p."categoryId"
    WHERE ${eligibleProductSql(organizationId)}
    ORDER BY c.name ASC
  `);
}

/** True when this product may be shown to a client of this organisation (used by the photo route). */
export async function isClientCatalogProduct(db: ClientPortalDb, organizationId: string, productId: string) {
  const rows = await db.$queryRaw<Array<Pick<CatalogRow, "imageHead" | "imageLength">>>(Prisma.sql`
    SELECT CASE WHEN lower(left(p."imageUrl", 5)) = 'data:' THEN left(p."imageUrl", 120) ELSE p."imageUrl" END AS "imageHead",
           length(p."imageUrl")::int AS "imageLength"
    FROM "Product" p
    WHERE p.id = ${productId} AND ${eligibleProductSql(organizationId)}
  `);
  return rows.length === 1 && photoIsValid(rows[0]);
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export type SubmitClientOrderDeps = {
  db: ClientPortalDb;
  /** Reserves the next CMD- number inside the order's transaction (DocumentSequence in production). */
  nextOrderNumber: (tx: Prisma.TransactionClient, organizationId: string) => Promise<string>;
  now?: () => Date;
};

export type SubmittedClientOrder = {
  created: boolean;
  order: ClientOrderSummaryDto;
};

function toSummary(order: {
  id: string;
  orderNumber: string;
  status: CustomerOrderStatusValue;
  totalTTC: Prisma.Decimal;
  createdAt: Date;
  convertedSale: { status: string } | null;
  lines: Array<{ quantity: number }>;
}): ClientOrderSummaryDto {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    totalTTC: Number(order.totalTTC),
    itemCount: order.lines.reduce((sum, line) => sum + line.quantity, 0),
    createdAt: order.createdAt.toISOString(),
    invoicePending: isInvoicePending(order.status, order.convertedSale?.status),
  };
}

const summarySelect = {
  id: true,
  orderNumber: true,
  status: true,
  totalTTC: true,
  createdAt: true,
  customerId: true,
  convertedSale: { select: { status: true } },
  lines: { select: { quantity: true } },
} as const;

/**
 * Records a customer order (status SUBMITTED). Everything is re-validated
 * here, server-side, from the session scope and the database only: the
 * customer is still ACTIVE, every product belongs to the organisation, is
 * ACTIVE and has a valid photo (i.e. is really in the catalogue), quantities
 * are bounded, prices come from Product.salePrice/taxRate and the total is
 * computed like a POS sale. The browser only ever sends {productId, quantity}.
 * Writes ONLY CustomerOrder (+ lines) and an AuditLog row.
 */
export async function submitClientOrder(
  deps: SubmitClientOrderDeps,
  scope: ClientScope,
  rawInput: unknown,
  meta: { ip: string },
): Promise<SubmittedClientOrder> {
  const parsed = clientOrderInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ClientPortalError("La commande est invalide.", 422, "INVALID_ORDER");
  }
  const input = parsed.data;
  const lines = mergeOrderLines(input.lines);
  const now = deps.now?.() ?? new Date();

  return inTransaction(deps.db, async (tx) => {
    // Same submission retried (double click, network retry): the order already exists.
    const existing = await tx.customerOrder.findFirst({
      where: { organizationId: scope.organizationId, idempotencyKey: input.idempotencyKey },
      select: summarySelect,
    });
    if (existing) {
      if (existing.customerId !== scope.customerId) {
        throw new ClientPortalError("La commande est invalide.", 409, "IDEMPOTENCY_CONFLICT");
      }
      return { created: false, order: toSummary(existing) };
    }

    const identity = await resolveClientIdentity(tx, scope);
    if (!identity) throw new ClientPortalError("Session client expirée.", 401, "SESSION_INVALID");

    const recentOrders = await tx.customerOrder.count({
      where: {
        organizationId: scope.organizationId,
        customerId: scope.customerId,
        createdAt: { gt: new Date(now.getTime() - 60 * 60 * 1000) },
      },
    });
    if (recentOrders >= CLIENT_ORDER_MAX_PER_HOUR) {
      throw new ClientPortalError(
        "Vous avez envoyé trop de commandes récemment. Réessayez plus tard.",
        429,
        "TOO_MANY_ORDERS",
      );
    }

    const productIds = lines.map((line) => line.productId);
    const products = await tx.$queryRaw<
      Array<Pick<CatalogRow, "id" | "name" | "reference" | "salePrice" | "taxRate" | "imageHead" | "imageLength">>
    >(Prisma.sql`
      SELECT p.id, p.name, p.reference, p."salePrice", p."taxRate",
             CASE WHEN lower(left(p."imageUrl", 5)) = 'data:' THEN left(p."imageUrl", 120) ELSE p."imageUrl" END AS "imageHead",
             length(p."imageUrl")::int AS "imageLength"
      FROM "Product" p
      WHERE p.id IN (${Prisma.join(productIds)}) AND ${eligibleProductSql(scope.organizationId)}
    `);
    const productById = new Map(products.filter(photoIsValid).map((product) => [product.id, product]));
    const unavailable = productIds.filter((id) => !productById.has(id));
    if (unavailable.length > 0) {
      throw new ClientPortalError(
        "Certains produits ne sont plus disponibles. Retirez-les du panier puis réessayez.",
        422,
        "PRODUCTS_UNAVAILABLE",
        { productIds: unavailable },
      );
    }

    const totals = computeClientOrderTotals(
      lines.map((line) => {
        const product = productById.get(line.productId)!;
        return {
          productId: line.productId,
          quantity: line.quantity,
          unitPriceHT: Number(product.salePrice),
          taxRate: Number(product.taxRate),
        };
      }),
    );

    if (input.expectedTotalTTC !== undefined && totalsDiffer(input.expectedTotalTTC, totals.totalTTC)) {
      throw new ClientPortalError(
        "Les prix ont changé depuis l'ajout au panier. Vérifiez le nouveau total puis confirmez à nouveau.",
        409,
        "PRICE_CHANGED",
        {
          totalTTC: totals.totalTTC,
          prices: totals.lines.map((line) => ({
            productId: line.productId,
            priceTTC: computePriceTTC(line.unitPriceHT, line.taxRate),
          })),
        },
      );
    }

    const orderNumber = await deps.nextOrderNumber(tx, scope.organizationId);
    const order = await tx.customerOrder.create({
      data: {
        organizationId: scope.organizationId,
        customerId: scope.customerId,
        orderNumber,
        status: "SUBMITTED",
        contactPhone: scope.contactPhone,
        note: input.note || null,
        subtotalHT: totals.subtotalHT,
        taxAmount: totals.taxAmount,
        roundingAmount: totals.roundingAmount,
        totalTTC: totals.totalTTC,
        idempotencyKey: input.idempotencyKey,
        lines: {
          create: totals.lines.map((line) => {
            const product = productById.get(line.productId)!;
            return {
              productId: line.productId,
              productName: product.name,
              productReference: product.reference,
              quantity: line.quantity,
              unitPriceHT: line.unitPriceHT,
              taxRate: line.taxRate,
              totalTTC: line.totalTTC,
            };
          }),
        },
      },
      select: summarySelect,
    });

    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        userId: null,
        action: "CLIENT_ORDER_SUBMITTED",
        entityType: "CustomerOrder",
        entityId: order.id,
        newValue: {
          orderNumber,
          customerId: scope.customerId,
          lineCount: totals.lines.length,
          totalTTC: totals.totalTTC,
        },
        ipAddress: meta.ip,
      },
    });

    return { created: true, order: toSummary(order) };
  });
}

/** The connected customer's own orders, most recent first (never another customer's). */
export async function listClientOrders(
  db: ClientPortalDb,
  scope: Pick<ClientScope, "organizationId" | "customerId">,
  limit = 20,
): Promise<ClientOrderSummaryDto[]> {
  const orders = await db.customerOrder.findMany({
    where: { organizationId: scope.organizationId, customerId: scope.customerId },
    select: summarySelect,
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(1, limit), 50),
  });
  return orders.map(toSummary);
}
