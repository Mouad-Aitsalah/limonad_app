import type { Prisma, PrismaClient } from "@/lib/generated/prisma/client";
import {
  aiPosDraftExpiry,
  candidateProbe,
  isAiPosDraftExpired,
  looksLikeCustomerNumber,
  parseAiPosDraftLines,
  resolveCustomerCandidates,
  resolveProductCandidates,
  type CustomerCandidate,
  type ProductCandidate,
} from "@/lib/assistant-pos-draft-rules";
import { formatCustomerCode, resolveCustomerCodeFromInput } from "@/lib/customer-code";
import {
  AiPosDraftConflictError,
  type AiPosDraftStore,
  type StoredAiPosDraft,
} from "@/lib/server/assistant-pos-draft-tool";

/**
 * Prisma implementation of AiPosDraftStore. The scope (organisation, user,
 * conversation) is fixed by the caller FROM THE SESSION (app/api/ai/chat) -
 * every query below is filtered by it, so a draft, product or customer of
 * another organisation (or another user's draft) can never be read or
 * written. No server-only import and no session read here, so the same code
 * is exercised against a throwaway database in the tests.
 *
 * Only AiPosDraft is ever written: no Sale, Payment, StockMovement,
 * StockLevel or AccountingEntry.
 */

const STRICT_CANDIDATES_LIMIT = 100;
const PROBE_CANDIDATES_LIMIT = 200;
const CUSTOMER_CANDIDATES_LIMIT = 50;

export type AiPosDraftScope = {
  organizationId: string;
  userId: string;
  conversationId: string;
};

const productSelect = { id: true, name: true, reference: true, barcode: true } as const;
const customerSelect = { id: true, name: true, code: true } as const;

function toCustomerCandidate(customer: { id: string; name: string; code: string }): CustomerCandidate {
  return { ...customer, displayCode: formatCustomerCode(customer.code) };
}

function toStoredDraft(row: {
  id: string;
  status: "OPEN" | "APPLIED" | "EXPIRED";
  lines: unknown;
  customerId: string | null;
  expiresAt: Date;
}): StoredAiPosDraft {
  return {
    id: row.id,
    status: row.status,
    lines: parseAiPosDraftLines(row.lines),
    customerId: row.customerId,
    expiresAt: row.expiresAt,
  };
}

async function withSerializableRetry<T>(operation: () => Promise<T>, maxAttempts = 5): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const prismaError = error as { code?: string; message?: string };
      const retryable =
        prismaError.code === "P2034" ||
        (prismaError.code === "P2010" && /40001|40P01/.test(prismaError.message ?? ""));
      if (!retryable || attempt >= maxAttempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
    }
  }
}

/** A client, or an open transaction (the tests run everything inside one and roll it back). */
export type AiPosDraftDb = PrismaClient | Prisma.TransactionClient;

export function createPrismaAiPosDraftStore(
  db: AiPosDraftDb,
  scope: AiPosDraftScope,
  options: { now?: () => Date } = {},
): AiPosDraftStore {
  const now = options.now ?? (() => new Date());
  const { organizationId, userId, conversationId } = scope;
  const draftWhere = { organizationId, userId, conversationId };
  const serializable = <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
    "$transaction" in db
      ? withSerializableRetry(() => db.$transaction(operation, { isolationLevel: "Serializable" }))
      : operation(db);

  return {
    async loadCurrentDraft() {
      const row =
        (await db.aiPosDraft.findFirst({ where: { ...draftWhere, status: "OPEN" } })) ??
        (await db.aiPosDraft.findFirst({ where: draftWhere, orderBy: { updatedAt: "desc" } }));
      if (!row) return null;
      if (row.status === "OPEN" && isAiPosDraftExpired(row.expiresAt, now())) {
        await db.aiPosDraft.updateMany({ where: { id: row.id, status: "OPEN" }, data: { status: "EXPIRED" } });
        return toStoredDraft({ ...row, status: "EXPIRED" });
      }
      return toStoredDraft(row);
    },

    async findProductCandidates(query) {
      const raw = query.trim();
      if (!raw) return [];
      // 1) what a plain search finds (exact barcode/reference, name/reference contains)
      const strict = await db.product.findMany({
        where: {
          organizationId,
          status: "ACTIVE",
          OR: [
            { barcode: raw },
            { reference: { equals: raw, mode: "insensitive" } },
            { name: { contains: raw, mode: "insensitive" } },
            { reference: { contains: raw, mode: "insensitive" } },
          ],
        },
        select: productSelect,
        orderBy: { name: "asc" },
        take: STRICT_CANDIDATES_LIMIT,
      });
      if (resolveProductCandidates(raw, strict).kind !== "none") return strict;
      // 2) accents / apostrophes / punctuation: "hawai" -> "Hawaï", "poms" -> "Pom's".
      // SQL contains is accent-sensitive, so fetch by a short prefix and let the
      // normalised matching (resolveProductCandidates) decide.
      const probe = candidateProbe(raw);
      if (!probe) return strict;
      return db.product.findMany({
        where: { organizationId, status: "ACTIVE", name: { contains: probe, mode: "insensitive" } },
        select: productSelect,
        orderBy: { name: "asc" },
        take: PROBE_CANDIDATES_LIMIT,
      });
    },

    async getProductsByIds(ids) {
      if (ids.length === 0) return [];
      const rows: ProductCandidate[] = await db.product.findMany({
        where: { organizationId, status: "ACTIVE", id: { in: ids } },
        select: productSelect,
      });
      return rows;
    },

    async findCustomerCandidates(query) {
      const raw = query.trim();
      if (!raw) return { exactNumberMatch: null, candidates: [] };

      // Same rule as the POS "N° client" box (resolveCustomerByNumber):
      // "15", "3421/15" or "342115" -> code in [input, legacy code].
      if (looksLikeCustomerNumber(raw)) {
        const legacyCode = resolveCustomerCodeFromInput(raw);
        const codes = [...new Set([raw, legacyCode].filter((value): value is string => Boolean(value)))];
        const byNumber = await db.customer.findFirst({
          where: { organizationId, status: "ACTIVE", code: { in: codes } },
          select: customerSelect,
        });
        if (byNumber) return { exactNumberMatch: toCustomerCandidate(byNumber), candidates: [] };
      }

      // Same order as searchCustomers: an exact code first, then name/code/phone/email.
      const exactCode = await db.customer.findFirst({
        where: { organizationId, status: "ACTIVE", code: raw },
        select: customerSelect,
      });
      if (exactCode) return { exactNumberMatch: null, candidates: [toCustomerCandidate(exactCode)] };

      const matches = await db.customer.findMany({
        where: {
          organizationId,
          status: "ACTIVE",
          OR: [
            { name: { contains: raw, mode: "insensitive" } },
            { code: { contains: raw, mode: "insensitive" } },
            { phone: { contains: raw, mode: "insensitive" } },
            { email: { contains: raw, mode: "insensitive" } },
          ],
        },
        select: customerSelect,
        orderBy: { name: "asc" },
        take: CUSTOMER_CANDIDATES_LIMIT,
      });
      const candidates = matches.map(toCustomerCandidate);
      if (resolveCustomerCandidates(raw, candidates).kind !== "none") {
        return { exactNumberMatch: null, candidates };
      }
      const probe = candidateProbe(raw);
      if (!probe) return { exactNumberMatch: null, candidates };
      const probed = await db.customer.findMany({
        where: { organizationId, status: "ACTIVE", name: { contains: probe, mode: "insensitive" } },
        select: customerSelect,
        orderBy: { name: "asc" },
        take: CUSTOMER_CANDIDATES_LIMIT,
      });
      return { exactNumberMatch: null, candidates: probed.map(toCustomerCandidate) };
    },

    async getCustomer(id) {
      const customer = await db.customer.findFirst({
        where: { id, organizationId, status: "ACTIVE" },
        select: customerSelect,
      });
      return customer ? toCustomerCandidate(customer) : null;
    },

    async getAvailableStock(productIds) {
      const user = await db.user.findFirst({
        where: { id: userId, organizationId },
        select: { depotId: true },
      });
      if (!user?.depotId) return null;
      const location = await db.stockLocation.findFirst({
        where: { organizationId, depotId: user.depotId, type: "DEPOT", active: true },
        select: { id: true },
      });
      if (!location) return null;
      const levels = productIds.length
        ? await db.stockLevel.findMany({
            where: { organizationId, locationId: location.id, productId: { in: productIds } },
            select: { productId: true, quantity: true, reservedQuantity: true },
          })
        : [];
      const available = new Map(productIds.map((id) => [id, 0]));
      for (const level of levels) available.set(level.productId, level.quantity - level.reservedQuantity);
      return available;
    },

    async saveDraft({ expectedDraftId, lines, customerId }) {
      return serializable(async (tx) => {
        // At most one OPEN draft per conversation: update it, else create one.
        const open = await tx.aiPosDraft.findFirst({
          where: { ...draftWhere, status: "OPEN" },
          select: { id: true },
        });
        if (expectedDraftId && open?.id !== expectedDraftId) throw new AiPosDraftConflictError();
        const data = {
          lines: lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
          customerId,
          expiresAt: aiPosDraftExpiry(now()),
        };
        return open
          ? tx.aiPosDraft.update({ where: { id: open.id }, data, select: { id: true, expiresAt: true } })
          : tx.aiPosDraft.create({
              data: { ...draftWhere, ...data, status: "OPEN" },
              select: { id: true, expiresAt: true },
            });
      });
    },
  };
}
