import "server-only";

import { checkAiPosDraftAccess, isAiPosDraftExpired, parseAiPosDraftLines } from "@/lib/assistant-pos-draft-rules";
import { prisma } from "@/lib/prisma";
import { getCustomerById } from "@/lib/server/customers";
import { OperationsServiceError } from "@/lib/server/depots";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import { getPosProductsByIds } from "@/lib/server/products";
import type { AiPosDraftForPosDto } from "@/types/ai-pos-draft-dto";
import type { CustomerDto } from "@/types/operations-dto";

/**
 * POS side of the AI-prepared cart (AiPosDraft). Reading and applying a draft
 * never creates a Sale, Payment, StockMovement or AccountingEntry: the POS only
 * fills its own cart, and the sale is created later by its normal validation.
 */

const POS_ROLES = ["admin", "depot_manager", "cashier"] as const;

async function loadDraftForSession(draftId: string) {
  const user = await requireOrganizationUser([...POS_ROLES]);
  const row = await prisma.aiPosDraft.findFirst({
    where: { id: draftId, organizationId: user.organizationId, userId: user.id },
  });
  const access = checkAiPosDraftAccess(row, { organizationId: user.organizationId, userId: user.id });
  if (!access.ok) {
    if (access.reason === "EXPIRED" && row?.status === "OPEN") {
      await prisma.aiPosDraft.updateMany({ where: { id: row.id, status: "OPEN" }, data: { status: "EXPIRED" } });
    }
    throw new OperationsServiceError(access.message, access.status);
  }
  return { user, row: row! };
}

async function posStockLocationId(organizationId: string, userId: string): Promise<string> {
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId },
    select: { depotId: true, depot: { select: { active: true } } },
  });
  if (!user?.depotId || !user.depot?.active) {
    throw new OperationsServiceError(
      "Aucun depot actif n'est associe a votre compte. Contactez un administrateur.",
      409,
    );
  }
  const location = await prisma.stockLocation.findFirst({
    where: { organizationId, depotId: user.depotId, type: "DEPOT", active: true },
    select: { id: true },
  });
  if (!location) throw new OperationsServiceError("Emplacement depot introuvable.", 404);
  return location.id;
}

/**
 * The draft as the POS needs it, fully re-validated now: same organisation and
 * author, OPEN, not expired; products still ACTIVE (each loaded explicitly with
 * its POS data and depot stock, even beyond the 500 preloaded ones); customer
 * still ACTIVE. Read-only - the draft stays OPEN until applyAiPosDraft.
 */
export async function getAiPosDraftForPos(draftId: string): Promise<AiPosDraftForPosDto> {
  const { user, row } = await loadDraftForSession(draftId);
  const locationId = await posStockLocationId(user.organizationId, user.id);
  const lines = parseAiPosDraftLines(row.lines);

  const products = await getPosProductsByIds({ locationId, ids: lines.map((line) => line.productId) });
  const sellable = new Set(products.map((product) => product.id));
  const droppedIds = lines.filter((line) => !sellable.has(line.productId)).map((line) => line.productId);
  const dropped = droppedIds.length
    ? await prisma.product.findMany({
        where: { organizationId: user.organizationId, id: { in: droppedIds } },
        select: { name: true },
      })
    : [];

  let customer: CustomerDto | null = null;
  let customerUnavailable = false;
  if (row.customerId) {
    try {
      const found = await getCustomerById(row.customerId);
      if (found.status === "ACTIVE") customer = found;
      else customerUnavailable = true;
    } catch (error) {
      if (!(error instanceof OperationsServiceError)) throw error;
      customerUnavailable = true;
    }
  }

  return {
    id: row.id,
    expiresAt: row.expiresAt.toISOString(),
    lines: lines.filter((line) => sellable.has(line.productId)),
    products,
    customer,
    unavailableProducts: [
      ...dropped.map((product) => product.name),
      ...Array(Math.max(0, droppedIds.length - dropped.length)).fill("Produit supprimé"),
    ],
    customerUnavailable,
  };
}

/**
 * Marks the draft APPLIED - atomically, only if it is still this user's OPEN,
 * unexpired draft - so a second click / tab / refresh on the same link can
 * never load it twice. Called by the POS right before it fills its cart.
 */
export async function applyAiPosDraft(draftId: string): Promise<{ id: string }> {
  const { user, row } = await loadDraftForSession(draftId);
  const now = new Date();
  const { count } = await prisma.aiPosDraft.updateMany({
    where: {
      id: row.id,
      organizationId: user.organizationId,
      userId: user.id,
      status: "OPEN",
      expiresAt: { gt: now },
    },
    data: { status: "APPLIED", appliedAt: now },
  });
  if (count !== 1) {
    // Raced with another tab, or it just expired: re-read the real reason.
    const latest = await prisma.aiPosDraft.findFirst({
      where: { id: row.id, organizationId: user.organizationId, userId: user.id },
      select: { status: true, expiresAt: true },
    });
    const expired = latest?.status === "EXPIRED" || (latest ? isAiPosDraftExpired(latest.expiresAt, now) : false);
    throw new OperationsServiceError(
      expired
        ? "Ce panier préparé a expiré. Demande à l'Assistant IA d'en préparer un nouveau."
        : "Ce panier préparé a déjà été ouvert dans le POS.",
      expired ? 410 : 409,
    );
  }
  return { id: row.id };
}
