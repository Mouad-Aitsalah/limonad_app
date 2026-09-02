import "server-only";

import { z } from "zod";

import { addMoney, MONEY_RANGE_MAX_NUMBER, multiplyMoney, subtractMoney } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import type {
  CreditNoteOrigin as PrismaCreditNoteOrigin,
  CreditNotePartyType as PrismaCreditNotePartyType,
  CreditNoteReason as PrismaCreditNoteReason,
  CreditNoteStatus as PrismaCreditNoteStatus,
} from "@/lib/generated/prisma/enums";
import type { CreditNoteGetPayload } from "@/lib/generated/prisma/models/CreditNote";
import type { StockMovementGetPayload } from "@/lib/generated/prisma/models/StockMovement";
import {
  postValidatedCreditNoteAccountingEntry,
  reverseAccountingEntryForSource,
} from "@/lib/server/accounting";
import { assertUserRole, requireSessionUser } from "@/lib/server/auth";
import { assertMoneyRange, OperationsServiceError } from "@/lib/server/depots";
import { DocumentType, reserveDocumentSequence } from "@/lib/server/document-sequence";
import {
  asOrganizationUser,
  requireOrganizationUser,
} from "@/lib/server/organization-context";
import type { CurrentUser } from "@/types/auth";
import type {
  CreateCreditNoteInput,
  CreateDriverReturnInput,
  CreditNote,
  CreditNoteLine,
  CreditNoteOrigin,
  CreditNotePartyType,
  CreditNoteReason,
  CreditNoteSaleOrigin,
  CreditNoteStatus,
  ReturnableProduct,
} from "@/types/credit-note";

const creditNoteInclude = {
  customer: { select: { id: true, name: true, code: true } },
  supplier: { select: { id: true, name: true, code: true, phone: true, city: true, active: true } },
  originalSale: {
    select: {
      id: true,
      invoiceNumber: true,
      origin: true,
      truck: { select: { id: true, code: true, registration: true } },
    },
  },
  stockDestinationLocation: { select: { id: true, name: true, code: true } },
  stockSourceLocation: { select: { id: true, name: true, code: true } },
  // F4: only ever set on a driver return (createDriverReturn) - distinct
  // from originalSale.truck above, which reflects the sale the return is
  // linked to (if any), not who/where the return itself was collected.
  tour: { select: { id: true, code: true } },
  driver: { select: { id: true, employeeCode: true, user: { select: { fullName: true } } } },
  createdBy: { select: { fullName: true } },
  validatedBy: { select: { fullName: true } },
  lines: {
    include: {
      // unit (Phase 3 CRITICAL #1 fix): embedded on CreditNoteLine so an
      // already-saved draft's cart line renders correctly even when its
      // product isn't in the picker's current small preload/search results
      // - see CreditNotePosView/SupplierCreditNotePosView's product search.
      product: { select: { reference: true, name: true, unit: true } },
      saleLine: {
        select: {
          id: true,
          sale: { select: { invoiceNumber: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  },
} as const;

const stockMovementInclude = {
  sourceLocation: { select: { name: true } },
  destinationLocation: { select: { name: true } },
} as const;

type CreditNoteRecord = CreditNoteGetPayload<{ include: typeof creditNoteInclude }>;
type StockMovementRecord = StockMovementGetPayload<{ include: typeof stockMovementInclude }>;

const reasonToPrisma: Record<CreditNoteReason, PrismaCreditNoteReason> = {
  produit_defectueux: "DEFECTIVE_PRODUCT",
  produit_endommage: "DAMAGED_PRODUCT",
  erreur_livraison: "DELIVERY_ERROR",
  erreur_fournisseur: "SUPPLIER_ERROR",
  erreur_quantite: "QUANTITY_ERROR",
  produit_non_conforme: "NON_COMPLIANT_PRODUCT",
  echange_client: "EXCHANGE_CUSTOMER",
  surplus_livraison: "SURPLUS_DELIVERY",
  retour_commercial: "COMMERCIAL_RETURN",
  produit_perime: "EXPIRED_PRODUCT",
  autre: "OTHER",
};

const reasonFromPrisma = Object.fromEntries(
  Object.entries(reasonToPrisma).map(([key, value]) => [value, key]),
) as Record<string, CreditNoteReason>;

const statusToUi: Record<string, CreditNoteStatus> = {
  DRAFT: "BROUILLON",
  VALIDATED: "VALIDE",
  REVERSED: "CONTREPASSE",
};

const statusToPrisma: Record<Exclude<CreditNoteStatus, "CONTREPASSE">, PrismaCreditNoteStatus> = {
  BROUILLON: "DRAFT",
  VALIDE: "VALIDATED",
};

const originToUi: Record<PrismaCreditNoteOrigin, CreditNoteOrigin> = {
  MANUAL: "retour_manuel",
  SALE: "facture",
};

const partyTypeToPrisma: Record<CreditNotePartyType, PrismaCreditNotePartyType> = {
  client: "CUSTOMER",
  fournisseur: "SUPPLIER",
};

const partyTypeToUi: Record<PrismaCreditNotePartyType, CreditNotePartyType> = {
  CUSTOMER: "client",
  SUPPLIER: "fournisseur",
};

const manualCreditNoteLineSchema = z.object({
  productId: z.string().trim().min(1, "Le produit est obligatoire."),
  // F8-D: input-level sanity bounds only, not the real protection - see
  // computeLineTotals/computeTotals's assertMoneyRange calls, the actual
  // gate on the computed amount.
  quantityReturned: z.coerce
    .number()
    .int("La quantite doit etre un entier.")
    .positive("La quantite retournee doit etre superieure a zero.")
    .max(1_000_000),
  unitPrice: z.coerce
    .number()
    .min(0, "Le prix de reprise doit etre positif.")
    .max(MONEY_RANGE_MAX_NUMBER)
    .optional(),
  discountPercent: z.coerce
    .number()
    .min(0, "La remise doit etre positive.")
    .max(100, "La remise ne peut pas depasser 100%.")
    .optional(),
  taxRate: z.coerce.number().min(0, "La TVA doit etre positive.").optional(),
  // F4: which SaleLine this line returns against - required when
  // returnMode is LINKED, forbidden when it is MANUAL (see
  // persistManualCreditNote's module doc comment).
  saleLineId: z.string().trim().nullable().optional(),
});

export const createCreditNoteSchema = z.object({
  id: z.string().trim().optional(),
  partyType: z.enum(["client", "fournisseur"]).default("client"),
  customerId: z.string().trim().nullable().optional(),
  supplierId: z.string().trim().nullable().optional(),
  // F4 finalization: LINKED vs MANUAL is now an explicit, required client
  // decision for a customer return - never inferred from whether a line
  // happens to carry a saleLineId. Required only when partyType is
  // "client" (checked in persistManualCreditNote): a supplier return has
  // no SaleLine-equivalent to link against, so this stays optional here
  // and unused on that path.
  returnMode: z.enum(["LINKED", "MANUAL"]).optional(),
  reason: z.enum([
    "produit_defectueux",
    "produit_endommage",
    "erreur_livraison",
    "erreur_fournisseur",
    "erreur_quantite",
    "produit_non_conforme",
    "echange_client",
    "surplus_livraison",
    "retour_commercial",
    "produit_perime",
    "autre",
  ]),
  comment: z.string().trim().nullable().optional(),
  returnDate: z.string().trim().min(1, "La date de retour est obligatoire."),
  stockDestinationLocationId: z
    .string()
    .trim()
    .nullable()
    .optional(),
  stockSourceLocationId: z.string().trim().nullable().optional(),
  lines: z.array(manualCreditNoteLineSchema).min(1, "Ajoutez au moins un produit."),
  // Same idempotency contract as Sale's - see lib/server/counter-sales.ts.
  // Only meaningful on the create path (no `id`, i.e. no existing draft
  // being updated); an update-by-id call is unaffected.
  idempotencyKey: z
    .string()
    .trim()
    .max(120)
    .nullable()
    .optional()
    .transform((value) => value || null),
});

type PersistedLine = {
  productId: string;
  productName: string;
  productReference: string;
  quantityReturned: number;
  unitPrice: number;
  discountPercent: number;
  taxRate: number;
  totalHT: number;
  taxAmount: number;
  totalTTC: number;
};

export async function getCreditNotes(sessionUser?: CurrentUser): Promise<CreditNote[]> {
  const currentUser = sessionUser
    ? asOrganizationUser(assertUserRole(sessionUser, ["admin", "depot_manager", "cashier"]))
    : await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const notes = await prisma.creditNote.findMany({
    where: { organizationId: currentUser.organizationId },
    include: creditNoteInclude,
    orderBy: [{ createdAt: "desc" }, { updatedAt: "desc" }],
  });

  return notes.map((note) => mapCreditNoteToDto(note));
}

export async function getCreditNoteById(
  id: string,
  sessionUser?: CurrentUser,
): Promise<CreditNote> {
  const currentUser = sessionUser
    ? asOrganizationUser(assertUserRole(sessionUser, ["admin", "depot_manager", "cashier"]))
    : await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const note = await prisma.creditNote.findFirst({
    where: { id, organizationId: currentUser.organizationId },
    include: creditNoteInclude,
  });

  if (!note) {
    throw new OperationsServiceError("Avoir introuvable.", 404);
  }

  const stockMovements = await prisma.stockMovement.findMany({
    where: {
      referenceId: id,
      organizationId: currentUser.organizationId,
    },
    include: stockMovementInclude,
    orderBy: { createdAt: "asc" },
  });

  return mapCreditNoteToDto(note, stockMovements);
}

export async function saveCreditNoteDraft(input: CreateCreditNoteInput): Promise<CreditNote> {
  return persistManualCreditNote(input, "BROUILLON");
}

export async function createManualCreditNote(input: CreateCreditNoteInput): Promise<CreditNote> {
  return persistManualCreditNote(input, "VALIDE");
}

export async function createCreditNote(
  input: CreateCreditNoteInput,
  status: CreditNoteStatus,
): Promise<CreditNote> {
  if (status === "BROUILLON") return saveCreditNoteDraft(input);
  if (status === "VALIDE") return createManualCreditNote(input);
  throw new OperationsServiceError("Statut de creation d'avoir invalide.", 422);
}

export async function validateCreditNote(id: string): Promise<CreditNote> {
  const user = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);

  return withSerializableRetry(async () =>
    prisma.$transaction(
      async (tx) => {
        const existing = await tx.creditNote.findFirst({
          where: { id, organizationId: user.organizationId },
          include: creditNoteInclude,
        });

        if (!existing) {
          throw new OperationsServiceError("Avoir introuvable.", 404);
        }
        if (existing.status !== "DRAFT") {
          throw new OperationsServiceError("Seul un brouillon peut etre valide.", 422);
        }
        if (existing.lines.length === 0) {
          throw new OperationsServiceError("Le brouillon ne contient aucune ligne.", 422);
        }
        // F4 finalization: the MANUAL-mode role restriction applies for
        // the note's whole lifecycle, not only at creation - a cashier
        // cannot validate a MANUAL draft even if an admin/depot_manager
        // created it. origin is the persisted, authoritative record of the
        // mode decision (see persistManualCreditNote).
        if (existing.partyType === "CUSTOMER" && existing.origin === "MANUAL") {
          assertUserRole(user, ["admin", "depot_manager"]);
        }

        // F4: re-enforce the returnable cap here too, not only at creation
        // time. A draft can sit for a while before being validated, and
        // other returns against the SAME saleLineId may have been
        // validated in the meantime - this is the authoritative check for
        // that case, using a fresh read inside this same transaction.
        for (const line of existing.lines) {
          if (!line.saleLineId) continue;
          const saleLine = await resolveSaleLineForReturn(tx, user.organizationId, line.saleLineId);
          if (!saleLine) {
            throw new OperationsServiceError("Ligne de vente d'origine introuvable.", 404);
          }
          const alreadyReturned = await computeAlreadyReturnedValidated(tx, saleLine.saleLineId);
          const returnable = saleLine.quantity - alreadyReturned;
          if (line.quantity > returnable) {
            throw new OperationsServiceError(
              `Quantite retournable depassee pour ${line.product.name} : ${returnable} restante(s) sur ${saleLine.quantity} vendue(s) (${alreadyReturned} deja retournee(s) entre-temps).`,
              422,
              { [line.productId]: `Maximum retournable : ${returnable}.` },
            );
          }
        }

        const persistedLines = existing.lines.map((line) => ({
          productId: line.productId,
          productName: line.product.name,
          productReference: line.product.reference,
          quantityReturned: line.quantity,
          unitPrice: line.unitPriceHT.toNumber(),
          discountPercent: line.discountRate.toNumber(),
          taxRate: line.taxRate.toNumber(),
          totalHT: line.totalHT.toNumber(),
          taxAmount: line.taxAmount.toNumber(),
          totalTTC: line.totalTTC.toNumber(),
        }));

        await applyValidationSideEffects(
          tx,
          user.organizationId,
          existing.id,
          existing.creditNoteNumber,
          existing.partyType,
          existing.stockDestinationLocationId,
          existing.stockSourceLocationId,
          persistedLines,
          user.id,
          existing.comment,
          existing.createdAt,
        );

        const validationDate = new Date();

        const updated = await tx.creditNote.update({
          where: { id },
          data: {
            status: "VALIDATED",
            validatedByUserId: user.id,
            validatedAt: validationDate,
          },
          include: creditNoteInclude,
        });

        await postValidatedCreditNoteAccountingEntry(tx, {
          organizationId: user.organizationId,
          creditNoteId: updated.id,
          creditNoteNumber: updated.creditNoteNumber,
          partyType: updated.partyType,
          refundMethod: updated.refundMethod,
          date: validationDate,
          subtotalHT: updated.subtotalHT,
          taxAmount: updated.taxAmount,
          totalTTC: updated.totalTTC,
          createdByUserId: user.id,
        });

        await tx.auditLog.create({
          data: {
            organizationId: user.organizationId,
            userId: user.id,
            action: "CREDIT_NOTE_VALIDATED",
            entityType: "CreditNote",
            entityId: existing.id,
            oldValue: { status: existing.status },
            newValue: { status: "VALIDATED" },
          },
        });

        return updated;
      },
      // 15s: same fix already applied to persistManualCreditNote's
      // transaction - this one now also chains the F4 returnable-cap
      // re-check (one extra sequential read per linked line) plus
      // accounting posting, which can exceed Prisma's 5s default against
      // Neon's serverless connection latency, even with no real conflict.
      { isolationLevel: "Serializable", timeout: 15000 },
    ),
  ).then((note) => mapCreditNoteToDto(note));
}

export async function reverseCreditNote(id: string): Promise<CreditNote> {
  const user = await requireOrganizationUser(["admin", "depot_manager"]);

  return withSerializableRetry(async () =>
    prisma.$transaction(
      async (tx) => {
        const note = await tx.creditNote.findFirst({
          where: { id, organizationId: user.organizationId },
          include: creditNoteInclude,
        });

        if (!note) {
          throw new OperationsServiceError("Avoir introuvable.", 404);
        }
        if (note.status !== "VALIDATED") {
          throw new OperationsServiceError(
            "Seul un avoir valide peut etre contre-passe.",
            422,
          );
        }

        // F9: the deterministic, append-only link to what THIS credit note
        // actually moved - never "every movement for this product" (which
        // could span other sales/purchases/avoirs entirely unrelated to
        // this one), and never recomputed from note.lines (CreditNoteLine
        // has no FK to the StockMovement it caused, and nothing stops two
        // lines from sharing a productId - iterating the real movements
        // instead sidesteps that ambiguity entirely: quantity and location
        // come from what was actually recorded at validation time, not a
        // second calculation that could in principle drift from it).
        // Scoped to this organization (never another tenant's movement) and
        // to this exact credit note (referenceType/referenceId), excluding
        // anything already linked to a reversal (reversalMovement: null) -
        // belt-and-suspenders on top of the note.status !== "VALIDATED"
        // guard above, since reversedMovementId is also @unique at the DB
        // level (a second reversal attempt on the same original movement
        // would fail closed with P2002, never silently double-apply).
        const originalMovements = await tx.stockMovement.findMany({
          where: {
            organizationId: user.organizationId,
            referenceType: "CREDIT_NOTE",
            referenceId: note.id,
            reversalMovement: null,
          },
          orderBy: { createdAt: "asc" },
        });

        if (note.partyType === "CUSTOMER") {
          if (!note.stockDestinationLocationId) {
            throw new OperationsServiceError("Destination de stock introuvable.", 422);
          }

          for (const movement of originalMovements) {
            if (!movement.destinationLocationId) continue;
            const level = await tx.stockLevel.findUnique({
              where: {
                productId_locationId: {
                  productId: movement.productId,
                  locationId: movement.destinationLocationId,
                },
              },
              select: { quantity: true },
            });

            if (!level || level.quantity < movement.quantity) {
              const productName =
                note.lines.find((line) => line.productId === movement.productId)?.product
                  .name ?? movement.productId;
              throw new OperationsServiceError(
                `Stock insuffisant pour contre-passer ${productName}.`,
                422,
              );
            }
          }

          for (const movement of originalMovements) {
            if (!movement.destinationLocationId) continue;
            await tx.stockLevel.update({
              where: {
                productId_locationId: {
                  productId: movement.productId,
                  locationId: movement.destinationLocationId,
                },
              },
              data: {
                quantity: { decrement: movement.quantity },
              },
            });

            // F9: the original movement (M1, CUSTOMER_RETURN) is never
            // mutated - no .update(), no status change - only a brand new
            // REVERSAL row (R1) is created, carrying reversedMovementId so
            // "R1 cancels exactly M1" is reconstructible without any
            // timestamp/product heuristic. M1.status stays VALIDATED
            // forever; see the F9 report for why (the schema's REVERSED
            // status value is never actually reachable under this
            // append-only design).
            await tx.stockMovement.create({
              data: {
                organizationId: user.organizationId,
                movementNumber: await nextMovementNumber(
                  tx,
                  user.organizationId,
                  new Date(),
                ),
                type: "REVERSAL",
                productId: movement.productId,
                quantity: movement.quantity,
                sourceLocationId: movement.destinationLocationId,
                destinationLocationId: null,
                referenceType: "CREDIT_NOTE_REVERSAL",
                referenceId: note.id,
                reason: `Contre-passation avoir ${note.creditNoteNumber}`,
                note: note.comment || null,
                createdByUserId: user.id,
                status: "VALIDATED",
                reversedMovementId: movement.id,
              },
            });
          }
        } else {
          if (!note.stockSourceLocationId) {
            throw new OperationsServiceError("Stock source introuvable.", 422);
          }

          for (const movement of originalMovements) {
            if (!movement.sourceLocationId) continue;
            await tx.stockLevel.upsert({
              where: {
                productId_locationId: {
                  productId: movement.productId,
                  locationId: movement.sourceLocationId,
                },
              },
              update: {
                quantity: { increment: movement.quantity },
              },
              create: {
                organizationId: user.organizationId,
                productId: movement.productId,
                locationId: movement.sourceLocationId,
                quantity: movement.quantity,
                reservedQuantity: 0,
              },
            });

            // F9: same append-only principle as the CUSTOMER branch above -
            // the original SUPPLIER_RETURN movement is never touched.
            await tx.stockMovement.create({
              data: {
                organizationId: user.organizationId,
                movementNumber: await nextMovementNumber(
                  tx,
                  user.organizationId,
                  new Date(),
                ),
                type: "REVERSAL",
                productId: movement.productId,
                quantity: movement.quantity,
                sourceLocationId: null,
                destinationLocationId: movement.sourceLocationId,
                referenceType: "CREDIT_NOTE_REVERSAL",
                referenceId: note.id,
                reason: `Contre-passation avoir ${note.creditNoteNumber}`,
                note: note.comment || null,
                createdByUserId: user.id,
                status: "VALIDATED",
                reversedMovementId: movement.id,
              },
            });
          }
        }

        const updated = await tx.creditNote.update({
          where: { id },
          data: {
            status: "REVERSED",
            reversedAt: new Date(),
          },
          include: creditNoteInclude,
        });

        await reverseAccountingEntryForSource(tx, {
          organizationId: user.organizationId,
          sourceType:
            note.partyType === "SUPPLIER"
              ? "SUPPLIER_CREDIT_NOTE"
              : "CUSTOMER_CREDIT_NOTE",
          sourceId: note.id,
          date: new Date(),
          reference: note.creditNoteNumber,
          description: `Contre-passation avoir ${note.creditNoteNumber}`,
          createdByUserId: user.id,
        });

        await tx.auditLog.create({
          data: {
            organizationId: user.organizationId,
            userId: user.id,
            action: "CREDIT_NOTE_REVERSED",
            entityType: "CreditNote",
            entityId: note.id,
            oldValue: { status: note.status },
            newValue: { status: "REVERSED" },
          },
        });

        const stockMovements = await tx.stockMovement.findMany({
          where: {
            referenceId: note.id,
            organizationId: user.organizationId,
          },
          include: stockMovementInclude,
          orderBy: { createdAt: "asc" },
        });

        return mapCreditNoteToDto(updated, stockMovements);
      },
      // 15s: same fix already applied to persistManualCreditNote's
      // transaction - verified live while testing F4's reversal flow
      // (reverseCreditNote's own accounting-entry posting plus its
      // per-line stock lookups can exceed Prisma's 5s default against
      // Neon's serverless connection latency, even with no real conflict).
      { isolationLevel: "Serializable", timeout: 15000 },
    ),
  );
}

export async function getReturnableProductsForCustomer(
  customerId: string,
): Promise<ReturnableProduct[]> {
  // "driver" included (F4): a driver return needs the same suggested
  // returnable-quantity figures the admin/depot_manager/cashier UI already
  // shows - this stays a read-only suggestion, createDriverReturn below is
  // still the sole authority that enforces the actual cap.
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier", "driver"]);
  return computeReturnableProducts(currentUser.organizationId, customerId);
}

const driverReturnLineSchema = z.object({
  productId: z.string().trim().min(1, "Le produit est obligatoire."),
  // F8-D: sanity bound only - see manualCreditNoteLineSchema's comment.
  quantityReturned: z.coerce
    .number()
    .int("La quantite doit etre un entier.")
    .positive("La quantite retournee doit etre superieure a zero.")
    .max(1_000_000),
  saleLineId: z.string().trim().nullable().optional(),
});

const driverReturnSchema = z.object({
  // F4 finalization: required (was optional) - every driver return must
  // now identify the customer it came from.
  customerId: z.string().trim().min(1, "Le client est obligatoire."),
  reason: z.enum([
    "produit_defectueux",
    "produit_endommage",
    "erreur_livraison",
    "erreur_fournisseur",
    "erreur_quantite",
    "produit_non_conforme",
    "echange_client",
    "surplus_livraison",
    "retour_commercial",
    "produit_perime",
    "autre",
  ]),
  comment: z.string().trim().nullable().optional(),
  lines: z.array(driverReturnLineSchema).min(1, "Ajoutez au moins un produit."),
  idempotencyKey: z
    .string()
    .trim()
    .max(120)
    .nullable()
    .optional()
    .transform((value) => value || null),
});

/**
 * F4 point 6: a return the driver records themselves, in real time, while
 * their tour is IN_PROGRESS and the product physically goes back onto
 * THEIR OWN truck. driverId/truckId/tourId are all derived from the
 * authenticated session and the driver's own real active tour - never from
 * the request body, exactly mirroring createDriverSale (F3). Always
 * CUSTOMER-party, always destined for the driver's own truck StockLocation
 * (never an arbitrary location the driver could pick), and always created
 * directly VALIDATED - drivers have no draft concept anywhere else in the
 * app (see createDriverSale), so none is introduced here either.
 *
 * A depot/counter return (persistManualCreditNote, the existing
 * admin/depot_manager/cashier path) never sets driverId/truckId/tourId -
 * that is precisely what lets getTourStockSheet tell the two apart (see
 * the F4 report).
 *
 * F4 finalization: customerId is now mandatory (was optional), always
 * verified against the driver's own organization and required ACTIVE -
 * never trusts anything beyond the id itself from the client. Every line
 * must also carry a saleLineId: a driver return is always LINKED, never
 * MANUAL - "driver" is not one of the roles allowed to create a MANUAL
 * return (see persistManualCreditNote), so no MANUAL path is exposed here
 * at all rather than silently rejecting it deep inside a shared helper.
 */
export async function createDriverReturn(input: CreateDriverReturnInput): Promise<CreditNote> {
  const user = await requireOrganizationUser(["driver"]);
  if (!user.driverId || !user.truckId) {
    throw new OperationsServiceError("Aucun camion n'est affecte a votre compte.", 403);
  }

  const parsed = driverReturnSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationsServiceError(
      "Certains champs sont invalides.",
      422,
      Object.fromEntries(
        parsed.error.issues.map((issue) => [issue.path.join(".") || "form", issue.message]),
      ),
    );
  }
  if (parsed.data.reason === "autre" && !parsed.data.comment?.trim()) {
    throw new OperationsServiceError("La justification est obligatoire pour le motif Autre.", 422);
  }

  // F4 finalization: a driver return is always LINKED - no MANUAL option
  // for drivers (the role restriction below only allows admin/depot_manager
  // to create a MANUAL return, and "driver" is not in that list). Checked
  // up front, before touching the database, so a driver return missing a
  // saleLineId is refused as clearly as possible.
  if (parsed.data.lines.some((line) => !line.saleLineId)) {
    throw new OperationsServiceError(
      "Chaque produit retourne doit referencer la vente d'origine (le retour manuel n'est pas disponible pour les chauffeurs).",
      422,
    );
  }

  const normalizedLines = normalizeManualLines(
    parsed.data.lines.map((line) => ({ ...line, saleLineId: line.saleLineId ?? null })),
  );
  const customerId = parsed.data.customerId.trim();
  const returnDate = new Date();

  return withIdempotentSerializableRetry(async () =>
    prisma.$transaction(
      async (tx) => {
        // Idempotency check first - identical contract to
        // persistManualCreditNote/createCounterSale (F5).
        if (parsed.data.idempotencyKey) {
          const existingByKey = await tx.creditNote.findFirst({
            where: {
              organizationId: user.organizationId,
              idempotencyKey: parsed.data.idempotencyKey,
            },
            include: creditNoteInclude,
          });
          if (existingByKey) return existingByKey;
        }

        const driver = await tx.driver.findFirst({
          where: { id: user.driverId, organizationId: user.organizationId },
          select: {
            id: true,
            active: true,
            truckId: true,
            truck: {
              select: {
                id: true,
                stockLocation: { select: { id: true, type: true, active: true } },
              },
            },
          },
        });
        if (!driver?.active || !driver.truck || driver.truckId !== user.truckId) {
          throw new OperationsServiceError("Profil chauffeur ou camion invalide.", 403);
        }

        // Same rule as F3 (createDriverSale): only while a real
        // IN_PROGRESS tour exists for this exact driver+truck+org. Refuses
        // both "before the tour starts" and "after Fin de tournee" the
        // same way - see the F4 report.
        const activeTour = await tx.tour.findFirst({
          where: {
            organizationId: user.organizationId,
            driverId: driver.id,
            truckId: driver.truck.id,
            status: "IN_PROGRESS",
          },
          select: { id: true },
          orderBy: { startedAt: "desc" },
        });
        if (!activeTour) {
          throw new OperationsServiceError(
            "Aucune tournee active. Le retour doit etre enregistre pendant une tournee en cours.",
            409,
          );
        }
        if (
          !driver.truck.stockLocation ||
          driver.truck.stockLocation.type !== "TRUCK" ||
          !driver.truck.stockLocation.active
        ) {
          throw new OperationsServiceError("Stock camion introuvable.", 404);
        }
        const truckLocationId = driver.truck.stockLocation.id;

        // F4 finalization: customerId is now mandatory (schema-enforced
        // above) and always org-scoped here - a customer id from another
        // organization can never resolve, the same guarantee already
        // established for idempotency keys (F5) and saleLineId (this file).
        const customer = await tx.customer.findFirst({
          where: { id: customerId, organizationId: user.organizationId },
          select: { id: true, status: true },
        });
        if (!customer) {
          throw new OperationsServiceError("Client introuvable.", 404);
        }
        if (customer.status !== "ACTIVE") {
          throw new OperationsServiceError("Client inactif ou bloque.", 409);
        }

        const { resolvedLines: persistedLines, originalSaleId, anyLinked } = await resolveReturnLines(tx, {
          organizationId: user.organizationId,
          partyType: "CUSTOMER",
          customerId,
          supplierId: null,
          lines: normalizedLines,
        });

        const totals = computeTotals(persistedLines);
        const validationDate = new Date();
        const creditNoteNumber = await nextCreditNoteNumber(
          tx,
          user.organizationId,
          returnDate,
          "client",
        );

        const created = await tx.creditNote.create({
          data: {
            organizationId: user.organizationId,
            creditNoteNumber,
            originalSaleId,
            partyType: "CUSTOMER",
            customerId,
            supplierId: null,
            status: "VALIDATED",
            // A driver return is always LINKED (every line is required to
            // carry a saleLineId below - drivers have no MANUAL option),
            // so origin is always "SALE" here regardless of whether
            // originalSaleId itself ends up null (lines linked to more
            // than one distinct sale - see resolveReturnLines).
            origin: "SALE",
            reason: reasonToPrisma[parsed.data.reason],
            comment: parsed.data.comment?.trim() || null,
            createdAt: returnDate,
            stockDestinationLocationId: truckLocationId,
            stockSourceLocationId: null,
            subtotalHT: totals.totalHT,
            taxAmount: totals.taxAmount,
            totalTTC: totals.totalTTC,
            createdByUserId: user.id,
            validatedByUserId: user.id,
            validatedAt: validationDate,
            idempotencyKey: parsed.data.idempotencyKey,
            driverId: driver.id,
            truckId: driver.truck.id,
            tourId: activeTour.id,
            lines: {
              create: persistedLines.map((line) => ({
                saleLineId: line.saleLineId,
                productId: line.productId,
                quantity: line.quantityReturned,
                unitPriceHT: line.unitPrice,
                discountRate: line.discountPercent,
                taxRate: line.taxRate,
                totalHT: line.totalHT,
                taxAmount: line.taxAmount,
                totalTTC: line.totalTTC,
              })),
            },
          },
          select: { id: true },
        });

        await applyValidationSideEffects(
          tx,
          user.organizationId,
          created.id,
          creditNoteNumber,
          "CUSTOMER",
          truckLocationId,
          null,
          persistedLines,
          user.id,
          parsed.data.comment,
          returnDate,
        );

        const note = await tx.creditNote.findFirstOrThrow({
          where: { id: created.id, organizationId: user.organizationId },
          include: creditNoteInclude,
        });

        await postValidatedCreditNoteAccountingEntry(tx, {
          organizationId: user.organizationId,
          creditNoteId: note.id,
          creditNoteNumber: note.creditNoteNumber,
          partyType: note.partyType,
          refundMethod: note.refundMethod,
          date: validationDate,
          subtotalHT: note.subtotalHT,
          taxAmount: note.taxAmount,
          totalTTC: note.totalTTC,
          createdByUserId: user.id,
        });

        const freeReturnMatches = customerId
          ? await findFreeReturnMatches(tx, user.organizationId, customerId, persistedLines)
          : [];

        await tx.auditLog.create({
          data: {
            organizationId: user.organizationId,
            userId: user.id,
            action: "CREDIT_NOTE_DRIVER_RETURN_CREATED",
            entityType: "CreditNote",
            entityId: created.id,
            newValue: {
              status: note.status,
              customerId: note.customerId,
              driverId: driver.id,
              truckId: driver.truck.id,
              tourId: activeTour.id,
              destination: note.stockDestinationLocationId,
              lineCount: persistedLines.length,
              // F4 finalization: a driver return is always LINKED (every
              // line is required to carry a saleLineId, checked above) -
              // drivers have no MANUAL option.
              returnMode: "LINKED",
              linkedToSale: anyLinked,
              freeReturnMatchedProductIds:
                freeReturnMatches.length > 0 ? freeReturnMatches : undefined,
            },
          },
        });

        return note;
      },
      { isolationLevel: "Serializable", timeout: 15000 },
    ),
  ).then((note) => mapCreditNoteToDto(note));
}

async function persistManualCreditNote(
  input: CreateCreditNoteInput,
  status: Exclude<CreditNoteStatus, "CONTREPASSE">,
): Promise<CreditNote> {
  const user = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const parsed = createCreditNoteSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationsServiceError(
      "Certains champs sont invalides.",
      422,
      Object.fromEntries(
        parsed.error.issues.map((issue) => [issue.path.join(".") || "form", issue.message]),
      ),
    );
  }

  if (parsed.data.reason === "autre" && !parsed.data.comment?.trim()) {
    throw new OperationsServiceError("La justification est obligatoire pour le motif Autre.", 422);
  }

  const partyType = parsed.data.partyType;

  // F4 finalization: LINKED vs MANUAL is an explicit, required decision for
  // a customer return - never inferred from whether a line happens to
  // carry a saleLineId. A supplier return has no SaleLine-equivalent to
  // link against, so this whole block is skipped for "fournisseur" and its
  // existing behavior (unchanged) stays admin/depot_manager/cashier, no
  // mode distinction.
  let returnMode: "LINKED" | "MANUAL" | null = null;
  if (partyType === "client") {
    if (!parsed.data.returnMode) {
      throw new OperationsServiceError(
        "Le mode de retour (lie ou manuel) est obligatoire.",
        422,
        { returnMode: "Choisissez un retour lie a une vente ou un retour manuel." },
      );
    }
    returnMode = parsed.data.returnMode;

    if (returnMode === "MANUAL") {
      // Checked before implementing: no existing business rule requires
      // cashier access to unlinked returns specifically - credit notes use
      // the same generic admin/depot_manager/cashier trio as almost every
      // other module in this app, not a documented decision distinct to
      // manual returns. See the F4 finalization report.
      assertUserRole(user, ["admin", "depot_manager"]);
      if (!parsed.data.comment?.trim()) {
        throw new OperationsServiceError(
          "La justification est obligatoire pour un retour manuel.",
          422,
          { comment: "Justification obligatoire pour un retour manuel." },
        );
      }
    }

    for (const line of parsed.data.lines) {
      if (returnMode === "LINKED" && !line.saleLineId) {
        throw new OperationsServiceError(
          "Chaque ligne d'un retour lie doit referencer sa vente d'origine.",
          422,
          { [line.productId]: "saleLineId obligatoire pour un retour lie." },
        );
      }
      if (returnMode === "MANUAL" && line.saleLineId) {
        throw new OperationsServiceError(
          "Un retour manuel ne peut pas etre lie a une vente d'origine (utilisez le mode lie).",
          422,
          { [line.productId]: "Retirez la reference a la vente d'origine, ou passez en mode lie." },
        );
      }
    }
  }

  const returnDate = parseReturnDate(parsed.data.returnDate);
  const normalizedLines = normalizeManualLines(parsed.data.lines);
  const customerId = partyType === "client" ? parsed.data.customerId?.trim() || null : null;
  const supplierId = partyType === "fournisseur" ? parsed.data.supplierId?.trim() || null : null;
  const destinationLocationId =
    partyType === "client" ? parsed.data.stockDestinationLocationId?.trim() || null : null;
  const sourceLocationId =
    partyType === "fournisseur" ? parsed.data.stockSourceLocationId?.trim() || null : null;

  if (partyType === "client" && !customerId) {
    throw new OperationsServiceError("Le client est obligatoire.", 422);
  }
  if (partyType === "fournisseur" && !supplierId) {
    throw new OperationsServiceError("Le fournisseur est obligatoire.", 422);
  }
  if (partyType === "client" && !destinationLocationId) {
    throw new OperationsServiceError("La destination du stock est obligatoire.", 422);
  }
  if (partyType === "fournisseur" && !sourceLocationId) {
    throw new OperationsServiceError("Le stock source est obligatoire.", 422);
  }

  return withIdempotentSerializableRetry(async () =>
    prisma.$transaction(
      async (tx) => {
        // Idempotency check first, before any other read - only on the
        // create path (no existing draft id targeted by this call). Same
        // contract as Sale's: organizationId always comes from the
        // authenticated session, never from the client.
        if (!parsed.data.id && parsed.data.idempotencyKey) {
          const existingByKey = await tx.creditNote.findFirst({
            where: {
              organizationId: user.organizationId,
              idempotencyKey: parsed.data.idempotencyKey,
            },
            include: creditNoteInclude,
          });
          if (existingByKey) return existingByKey;
        }

        const existingDraft = parsed.data.id
          ? await tx.creditNote.findFirst({
              where: {
                id: parsed.data.id,
                organizationId: user.organizationId,
              },
              include: { lines: true },
            })
          : null;

        if (parsed.data.id && !existingDraft) {
          throw new OperationsServiceError("Brouillon introuvable.", 404);
        }
        if (existingDraft && existingDraft.status !== "DRAFT") {
          throw new OperationsServiceError("Seul un brouillon peut etre modifie.", 422);
        }

        const [customer, supplier, destination, sourceLocation] = await Promise.all([
          customerId
            ? tx.customer.findFirst({
                where: { id: customerId, organizationId: user.organizationId },
                select: { id: true, name: true },
              })
            : Promise.resolve(null),
          supplierId
            ? tx.supplier.findFirst({
                where: { id: supplierId, organizationId: user.organizationId },
                select: { id: true, name: true, active: true },
              })
            : Promise.resolve(null),
          destinationLocationId
            ? tx.stockLocation.findFirst({
                where: {
                  id: destinationLocationId,
                  organizationId: user.organizationId,
                },
                select: { id: true, name: true, active: true },
              })
            : Promise.resolve(null),
          sourceLocationId
            ? tx.stockLocation.findFirst({
                where: {
                  id: sourceLocationId,
                  organizationId: user.organizationId,
                },
                select: { id: true, name: true, active: true },
              })
            : Promise.resolve(null),
        ]);

        if (partyType === "client" && !customer) {
          throw new OperationsServiceError("Client introuvable.", 422);
        }
        if (partyType === "fournisseur" && (!supplier || !supplier.active)) {
          throw new OperationsServiceError("Fournisseur introuvable ou inactif.", 422);
        }
        if (partyType === "client" && (!destination || !destination.active)) {
          throw new OperationsServiceError("Destination de stock non autorisee.", 422);
        }
        if (partyType === "fournisseur" && (!sourceLocationId || !sourceLocation || !sourceLocation.active)) {
          throw new OperationsServiceError("Stock source non autorise.", 422);
        }

        // F4: links (saleLineId) + caps (returnableQuantity) every line in
        // one pass - see resolveReturnLines's own doc comment. Runs for
        // BOTH draft and direct-validate: a saved draft that already
        // exceeds the cap is refused immediately rather than only failing
        // later at validateCreditNote.
        const { resolvedLines: persistedLines, originalSaleId, anyLinked } = await resolveReturnLines(tx, {
          organizationId: user.organizationId,
          partyType: partyTypeToPrisma[partyType],
          customerId,
          supplierId,
          lines: normalizedLines,
        });

        // F4: a free-return line (no saleLineId) that happens to match a
        // product this same customer could actually have linked is never
        // silently blocked (free returns stay a legitimate, intentional
        // path - see the F4 report) - but it is never silent either: it is
        // called out explicitly in the audit log entry below instead.
        const freeReturnMatches = customerId
          ? await findFreeReturnMatches(tx, user.organizationId, customerId, persistedLines)
          : [];

        const totals = computeTotals(persistedLines);
        const validationDate = status === "VALIDE" ? new Date() : null;

        let creditNoteId = existingDraft?.id ?? null;
        let creditNoteNumber = existingDraft?.creditNoteNumber ?? null;

        if (existingDraft) {
          await tx.creditNote.update({
            where: { id: existingDraft.id },
            data: {
              partyType: partyTypeToPrisma[partyType],
              customerId,
              supplierId,
              status: statusToPrisma[status],
              // F4 finalization: driven directly by the explicit
              // returnMode decision (client) - never reconstructed from
              // originalSaleId, which can be null even for a fully LINKED
              // return whose lines span more than one distinct sale (see
              // resolveReturnLines). Always "MANUAL" for a supplier return
              // (returnMode is null there - no change from prior behavior).
              origin: partyType === "client" && returnMode === "LINKED" ? "SALE" : "MANUAL",
              originalSaleId,
              reason: reasonToPrisma[parsed.data.reason],
              comment: parsed.data.comment?.trim() || null,
              createdAt: returnDate,
              stockDestinationLocationId: destinationLocationId,
              stockSourceLocationId: sourceLocationId,
              subtotalHT: totals.totalHT,
              taxAmount: totals.taxAmount,
              totalTTC: totals.totalTTC,
              validatedByUserId: status === "VALIDE" ? user.id : null,
              validatedAt: validationDate,
              reversedAt: null,
            },
          });

          await tx.creditNoteLine.deleteMany({ where: { creditNoteId: existingDraft.id } });

          await tx.creditNoteLine.createMany({
            data: persistedLines.map((line) => ({
              creditNoteId: existingDraft.id,
              saleLineId: line.saleLineId,
              productId: line.productId,
              quantity: line.quantityReturned,
              unitPriceHT: line.unitPrice,
              discountRate: line.discountPercent,
              taxRate: line.taxRate,
              totalHT: line.totalHT,
              taxAmount: line.taxAmount,
              totalTTC: line.totalTTC,
            })),
          });
        } else {
          creditNoteNumber = await nextCreditNoteNumber(
            tx,
            user.organizationId,
            returnDate,
            partyType,
          );

          const created = await tx.creditNote.create({
            data: {
              organizationId: user.organizationId,
              creditNoteNumber,
              originalSaleId,
              partyType: partyTypeToPrisma[partyType],
              customerId,
              supplierId,
              status: statusToPrisma[status],
              // Same rule as the update branch above.
              origin: partyType === "client" && returnMode === "LINKED" ? "SALE" : "MANUAL",
              reason: reasonToPrisma[parsed.data.reason],
              comment: parsed.data.comment?.trim() || null,
              createdAt: returnDate,
              stockDestinationLocationId: destinationLocationId,
              stockSourceLocationId: sourceLocationId,
              subtotalHT: totals.totalHT,
              taxAmount: totals.taxAmount,
              totalTTC: totals.totalTTC,
              createdByUserId: user.id,
              validatedByUserId: status === "VALIDE" ? user.id : null,
              validatedAt: validationDate,
              idempotencyKey: parsed.data.idempotencyKey,
              lines: {
                create: persistedLines.map((line) => ({
                  saleLineId: line.saleLineId,
                  productId: line.productId,
                  quantity: line.quantityReturned,
                  unitPriceHT: line.unitPrice,
                  discountRate: line.discountPercent,
                  taxRate: line.taxRate,
                  totalHT: line.totalHT,
                  taxAmount: line.taxAmount,
                  totalTTC: line.totalTTC,
                })),
              },
            },
            select: { id: true },
          });

          creditNoteId = created.id;
        }

        if (!creditNoteId || !creditNoteNumber) {
          throw new OperationsServiceError("Impossible de generer l'avoir.", 500);
        }

        if (status === "VALIDE") {
          await applyValidationSideEffects(
            tx,
            user.organizationId,
            creditNoteId,
            creditNoteNumber,
            partyTypeToPrisma[partyType],
            destinationLocationId,
            sourceLocationId,
            persistedLines,
            user.id,
            parsed.data.comment,
            returnDate,
          );
        }

        const note = await tx.creditNote.findFirstOrThrow({
          where: { id: creditNoteId, organizationId: user.organizationId },
          include: creditNoteInclude,
        });

        if (status === "VALIDE") {
          await postValidatedCreditNoteAccountingEntry(tx, {
            organizationId: user.organizationId,
            creditNoteId: note.id,
            creditNoteNumber: note.creditNoteNumber,
            partyType: note.partyType,
            refundMethod: note.refundMethod,
            date: validationDate ?? new Date(),
            subtotalHT: note.subtotalHT,
            taxAmount: note.taxAmount,
            totalTTC: note.totalTTC,
            createdByUserId: user.id,
          });
        }

        await tx.auditLog.create({
          data: {
            organizationId: user.organizationId,
            userId: user.id,
            action: existingDraft
              ? status === "VALIDE"
                ? "CREDIT_NOTE_UPDATED_AND_VALIDATED"
                : "CREDIT_NOTE_DRAFT_UPDATED"
              : status === "VALIDE"
                ? "CREDIT_NOTE_CREATED"
                : "CREDIT_NOTE_DRAFT_CREATED",
            entityType: "CreditNote",
            entityId: creditNoteId,
            oldValue: existingDraft
              ? {
                  status: existingDraft.status,
                  customerId: existingDraft.customerId,
                  supplierId: existingDraft.supplierId,
                  destination: existingDraft.stockDestinationLocationId,
                  source: existingDraft.stockSourceLocationId,
                }
              : undefined,
            newValue: {
              status: note.status,
              customerId: note.customerId,
              supplierId: note.supplierId,
              destination: note.stockDestinationLocationId,
              source: note.stockSourceLocationId,
              lineCount: persistedLines.length,
              // F4 finalization: the explicit mode decision itself
              // (mandatory AuditLog entry for every MANUAL return), plus
              // the pre-existing linked/free trace and any free line that
              // matched a real purchase - see findFreeReturnMatches.
              returnMode,
              linkedToSale: anyLinked,
              freeReturnMatchedProductIds:
                freeReturnMatches.length > 0 ? freeReturnMatches : undefined,
            },
          },
        });

        return note;
      },
      // 15s: same fix already applied to counter-sales.ts / driver-sales.ts's
      // equivalent transactions - this one chains several sequential
      // lookups plus accounting bootstrap/posting (ensureAccountingBootstrap,
      // postValidatedCreditNoteAccountingEntry), which can exceed Prisma's 5s
      // default interactive-transaction timeout (P2028) against Neon's
      // serverless connection latency, even with no real conflict. Verified
      // live while testing F5's idempotency check here (which adds one more
      // sequential read to an already-borderline-slow transaction).
      { isolationLevel: "Serializable", timeout: 15000 },
    ),
  ).then((note) => mapCreditNoteToDto(note));
}

async function applyValidationSideEffects(
  tx: Pick<typeof prisma, "stockLevel" | "stockMovement" | "$queryRaw">,
  organizationId: string,
  creditNoteId: string,
  creditNoteNumber: string,
  partyType: PrismaCreditNotePartyType,
  destinationLocationId: string | null,
  sourceLocationId: string | null,
  lines: PersistedLine[],
  userId: string,
  comment: string | null | undefined,
  returnDate: Date,
) {
  for (const line of lines) {
    if (partyType === "CUSTOMER") {
      if (!destinationLocationId) {
        throw new OperationsServiceError("Destination de stock introuvable.", 422);
      }

      await tx.stockLevel.upsert({
        where: {
          productId_locationId: {
            productId: line.productId,
            locationId: destinationLocationId,
          },
        },
        update: {
          quantity: { increment: line.quantityReturned },
        },
        create: {
          organizationId,
          productId: line.productId,
          locationId: destinationLocationId,
          quantity: line.quantityReturned,
          reservedQuantity: 0,
        },
      });

      await tx.stockMovement.create({
        data: {
          organizationId,
          movementNumber: await nextMovementNumber(tx, organizationId, returnDate),
          type: "CUSTOMER_RETURN",
          productId: line.productId,
          quantity: line.quantityReturned,
          sourceLocationId: null,
          destinationLocationId,
          referenceType: "CREDIT_NOTE",
          referenceId: creditNoteId,
          reason: `Avoir client ${creditNoteNumber}`,
          note: comment?.trim() || null,
          createdByUserId: userId,
          status: "VALIDATED",
        },
      });
      continue;
    }

    if (!sourceLocationId) {
      throw new OperationsServiceError("Stock source introuvable.", 422);
    }

    const level = await tx.stockLevel.findUnique({
      where: {
        productId_locationId: {
          productId: line.productId,
          locationId: sourceLocationId,
        },
      },
      select: { quantity: true },
    });

    if (!level || level.quantity < line.quantityReturned) {
      throw new OperationsServiceError(
        `Stock insuffisant pour retourner ${line.productName} au fournisseur.`,
        422,
      );
    }

    await tx.stockLevel.update({
      where: {
        productId_locationId: {
          productId: line.productId,
          locationId: sourceLocationId,
        },
      },
      data: {
        quantity: { decrement: line.quantityReturned },
      },
    });

    await tx.stockMovement.create({
      data: {
        organizationId,
        movementNumber: await nextMovementNumber(tx, organizationId, returnDate),
        type: "SUPPLIER_RETURN",
        productId: line.productId,
        quantity: line.quantityReturned,
        sourceLocationId,
        destinationLocationId: null,
        referenceType: "CREDIT_NOTE",
        referenceId: creditNoteId,
        reason: `Avoir fournisseur ${creditNoteNumber}`,
        note: comment?.trim() || null,
        createdByUserId: userId,
        status: "VALIDATED",
      },
    });
  }
}

function mapCreditNoteToDto(
  note: CreditNoteRecord,
  stockMovements: StockMovementRecord[] = [],
): CreditNote {
  const saleOrigin: CreditNoteSaleOrigin = note.originalSale
    ? note.originalSale.origin === "TRUCK"
      ? "camion"
      : "comptoir"
    : null;

  return {
    id: note.id,
    number: note.creditNoteNumber,
    partyType: partyTypeToUi[note.partyType],
    invoiceId: note.originalSaleId ?? null,
    invoiceNumber: note.originalSale?.invoiceNumber ?? null,
    customerId: note.customerId ?? null,
    customerName: note.customer?.name ?? null,
    supplierId: note.supplierId ?? null,
    supplierName: note.supplier?.name ?? null,
    supplierCode: note.supplier?.code ?? null,
    origin: originToUi[note.origin],
    saleOrigin,
    truckId: note.originalSale?.truck?.id ?? null,
    truckLabel: note.originalSale?.truck
      ? `${note.originalSale.truck.code} - ${note.originalSale.truck.registration}`
      : null,
    sourceLabel:
      note.partyType === "SUPPLIER"
        ? "Retour fournisseur"
        : note.origin === "MANUAL"
        ? "Retour manuel"
        : note.originalSale?.invoiceNumber ?? "Facture",
    driverReturnTourId: note.tour?.id ?? null,
    driverReturnTourCode: note.tour?.code ?? null,
    driverReturnDriverName: note.driver?.user.fullName ?? null,
    tourneeClosed: true,
    stockDestinationLocationId: note.stockDestinationLocationId ?? null,
    stockDestinationLocationName: note.stockDestinationLocation?.name ?? null,
    stockSourceLocationId: note.stockSourceLocationId ?? null,
    stockSourceLocationName: note.stockSourceLocation?.name ?? null,
    reason: reasonFromPrisma[note.reason] ?? "autre",
    comment: note.comment ?? "",
    returnDate: note.createdAt.toISOString(),
    status: statusToUi[note.status] ?? "BROUILLON",
    lines: note.lines.map((line) => ({
      id: line.id,
      saleLineId: line.saleLineId ?? null,
      productId: line.productId,
      productName: line.product.name,
      productReference: line.product.reference,
      productUnit: line.product.unit,
      invoiceNumber: line.saleLine?.sale.invoiceNumber ?? null,
      quantityReturned: line.quantity,
      unitPrice: line.unitPriceHT.toNumber(),
      discountPercent: line.discountRate.toNumber(),
      taxRate: line.taxRate.toNumber(),
      totalHT: line.totalHT.toNumber(),
      taxAmount: line.taxAmount.toNumber(),
      totalTTC: line.totalTTC.toNumber(),
    })),
    createdBy: note.createdBy.fullName,
    validatedBy: note.validatedBy?.fullName ?? null,
    validatedAt: note.validatedAt?.toISOString() ?? null,
    reversedAt: note.reversedAt?.toISOString() ?? null,
    stockMovements: stockMovements.map((movement) => ({
      id: movement.id,
      movementNumber: movement.movementNumber,
      type: movement.type,
      quantity: movement.quantity,
      destinationLocationName: movement.destinationLocation?.name ?? null,
      sourceLocationName: movement.sourceLocation?.name ?? null,
      createdAt: movement.createdAt.toISOString(),
      status: movement.status,
    })),
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

type ResolvedSaleLineForReturn = {
  saleLineId: string;
  saleId: string;
  productId: string;
  quantity: number;
  customerId: string | null;
};

/**
 * F4: server-side authority for "which SaleLine does this return line
 * point at" - org-scoped lookup, never trusts anything beyond the id
 * itself from the client.
 */
async function resolveSaleLineForReturn(
  tx: Pick<typeof prisma, "saleLine">,
  organizationId: string,
  saleLineId: string,
): Promise<ResolvedSaleLineForReturn | null> {
  const saleLine = await tx.saleLine.findFirst({
    where: { id: saleLineId, sale: { organizationId } },
    select: {
      id: true,
      productId: true,
      quantity: true,
      saleId: true,
      sale: { select: { customerId: true } },
    },
  });
  if (!saleLine) return null;
  return {
    saleLineId: saleLine.id,
    saleId: saleLine.saleId,
    productId: saleLine.productId,
    quantity: saleLine.quantity,
    customerId: saleLine.sale.customerId,
  };
}

/**
 * F4: quantity already returned and VALIDATED (never DRAFT, never
 * REVERSED - see the comment on computeReturnableProducts's own filter,
 * which must stay identical) against one specific SaleLine. This is the
 * exact figure returnableQuantity is computed from, and it always runs
 * inside the caller's own Serializable transaction so a concurrent return
 * against the same SaleLine is resolved by the transaction, not by this
 * read alone (see "double retour" in the F4 report).
 */
async function computeAlreadyReturnedValidated(
  tx: Pick<typeof prisma, "creditNoteLine">,
  saleLineId: string,
): Promise<number> {
  const aggregate = await tx.creditNoteLine.aggregate({
    where: { saleLineId, creditNote: { status: "VALIDATED" } },
    _sum: { quantity: true },
  });
  return aggregate._sum.quantity ?? 0;
}

type LineResolutionInput = {
  productId: string;
  quantityReturned: number;
  unitPrice?: number;
  discountPercent?: number;
  taxRate?: number;
  saleLineId?: string | null;
};

type ResolvedReturnLine = PersistedLine & { saleLineId: string | null };

/**
 * F4 core: resolves and prices every requested return line, and - for any
 * line that carries a saleLineId (a "retour lie", type A) - verifies it
 * (belongs to this org, matches the product, matches the selected customer
 * when there is one) and enforces returnableQuantity = saleLine.quantity -
 * computeAlreadyReturnedValidated(saleLineId), refusing the whole request
 * if exceeded. A line with no saleLineId is a free return (type B),
 * intentionally left uncapped - see the F4 report for the business
 * rationale and the risks. Never trusts a client-supplied "max returnable"
 * figure: this is the ONLY place that decides it, always from a fresh read
 * inside the caller's own transaction.
 */
async function resolveReturnLines(
  tx: Pick<typeof prisma, "saleLine" | "creditNoteLine" | "product">,
  params: {
    organizationId: string;
    partyType: PrismaCreditNotePartyType;
    customerId: string | null;
    supplierId: string | null;
    lines: LineResolutionInput[];
  },
): Promise<{
  resolvedLines: ResolvedReturnLine[];
  originalSaleId: string | null;
  anyLinked: boolean;
}> {
  const productIds = params.lines.map((line) => line.productId);
  const products = await tx.product.findMany({
    where: { id: { in: productIds }, organizationId: params.organizationId },
    select: {
      id: true,
      name: true,
      reference: true,
      purchasePrice: true,
      salePrice: true,
      taxRate: true,
      status: true,
      defaultSupplierId: true,
    },
  });
  const productMap = new Map(products.map((product) => [product.id, product]));

  const saleIdsSeen = new Set<string>();
  const resolvedLines: ResolvedReturnLine[] = [];

  for (const line of params.lines) {
    const product = productMap.get(line.productId);
    if (!product || product.status !== "ACTIVE") {
      throw new OperationsServiceError("Un produit selectionne est introuvable ou inactif.", 422);
    }
    if (
      params.partyType === "SUPPLIER" &&
      params.supplierId &&
      product.defaultSupplierId &&
      product.defaultSupplierId !== params.supplierId
    ) {
      throw new OperationsServiceError(
        `Le produit ${product.name} n'est pas rattache a ce fournisseur.`,
        422,
      );
    }

    let saleLineId: string | null = null;
    if (line.saleLineId) {
      const saleLine = await resolveSaleLineForReturn(tx, params.organizationId, line.saleLineId);
      if (!saleLine) {
        throw new OperationsServiceError("Ligne de vente d'origine introuvable.", 404);
      }
      if (saleLine.productId !== line.productId) {
        throw new OperationsServiceError(
          "Le produit ne correspond pas a la ligne de vente d'origine.",
          422,
        );
      }
      if (params.customerId && saleLine.customerId && saleLine.customerId !== params.customerId) {
        throw new OperationsServiceError(
          "Cette ligne de vente n'appartient pas au client selectionne.",
          422,
        );
      }

      const alreadyReturned = await computeAlreadyReturnedValidated(tx, saleLine.saleLineId);
      const returnable = saleLine.quantity - alreadyReturned;
      if (line.quantityReturned > returnable) {
        throw new OperationsServiceError(
          `Quantite retournable depassee pour ${product.name} : ${returnable} restante(s) sur ${saleLine.quantity} vendue(s) (${alreadyReturned} deja retournee(s)).`,
          422,
          { [line.productId]: `Maximum retournable : ${returnable}.` },
        );
      }

      saleLineId = saleLine.saleLineId;
      saleIdsSeen.add(saleLine.saleId);
    }

    const unitPrice =
      line.unitPrice ??
      (params.partyType === "SUPPLIER" ? product.purchasePrice.toNumber() : product.salePrice.toNumber());
    const discountPercent = line.discountPercent ?? 0;
    const taxRate = line.taxRate ?? product.taxRate.toNumber();
    const totals = computeLineTotals({
      productId: line.productId,
      quantityReturned: line.quantityReturned,
      unitPrice,
      discountPercent,
      taxRate,
    });

    resolvedLines.push({
      productId: line.productId,
      productName: product.name,
      productReference: product.reference,
      quantityReturned: line.quantityReturned,
      unitPrice,
      discountPercent,
      taxRate,
      totalHT: totals.totalHT,
      taxAmount: totals.taxAmount,
      totalTTC: totals.totalTTC,
      saleLineId,
    });
  }

  const anyLinked = resolvedLines.some((line) => line.saleLineId !== null);
  // A single CreditNote.originalSaleId can only ever point at ONE sale: if
  // every linked line traces back to the same sale, use it; if lines are
  // linked to different sales (or mixed with free lines), it stays null -
  // each LINE still keeps its own correct saleLineId regardless (see the
  // F4 report on why this is the honest behavior for a single nullable
  // field on the parent row).
  const originalSaleId = anyLinked && saleIdsSeen.size === 1 ? [...saleIdsSeen][0]! : null;

  return { resolvedLines, originalSaleId, anyLinked };
}

/**
 * F4: never blocks a free return (B) - that stays a legitimate, intentional
 * path an admin/depot_manager/cashier can use - but it must never be
 * SILENT when it happens to match a product this exact customer could
 * actually have linked (A) instead. Returns the productIds of every free
 * (saleLineId-less) line that has at least one real, currently-returnable
 * SaleLine for this customer, so the caller can record it explicitly in
 * the audit log rather than let it pass unremarked.
 */
async function findFreeReturnMatches(
  tx: Pick<typeof prisma, "saleLine">,
  organizationId: string,
  customerId: string,
  resolvedLines: ResolvedReturnLine[],
): Promise<string[]> {
  const freeProductIds = [
    ...new Set(
      resolvedLines.filter((line) => line.saleLineId === null).map((line) => line.productId),
    ),
  ];
  if (freeProductIds.length === 0) return [];

  const candidateLines = await tx.saleLine.findMany({
    where: {
      productId: { in: freeProductIds },
      sale: { organizationId, customerId },
    },
    select: {
      id: true,
      productId: true,
      quantity: true,
      creditNoteLines: {
        where: { creditNote: { status: "VALIDATED" } },
        select: { quantity: true },
      },
    },
  });

  const matched = new Set<string>();
  for (const line of candidateLines) {
    const returned = line.creditNoteLines.reduce((sum, item) => sum + item.quantity, 0);
    if (line.quantity - returned > 0) matched.add(line.productId);
  }
  return [...matched];
}

async function computeReturnableProducts(
  organizationId: string,
  customerId: string,
) {
  const sales = await prisma.sale.findMany({
    where: {
      organizationId,
      customerId,
      validatedAt: { not: null },
      status: { in: ["VALIDATED", "PARTIALLY_PAID", "PAID", "CREDIT"] },
    },
    select: {
      id: true,
      invoiceNumber: true,
      createdAt: true,
      stockLocationId: true,
      stockLocation: { select: { name: true } },
      lines: {
        select: {
          id: true,
          productId: true,
          quantity: true,
          unitPriceHT: true,
          discountRate: true,
          taxRate: true,
          product: { select: { reference: true, name: true } },
          // F4: only VALIDATED returns consume the returnable quantity - a
          // still-open DRAFT has no real effect yet (no stock moved, no
          // money moved) and must not block a legitimate return, and a
          // REVERSED one has already given the quantity back. Must match
          // computeAlreadyReturnedValidated exactly, since that is the
          // function that actually enforces the cap at validation time -
          // this one only feeds the UI's suggested figure.
          creditNoteLines: {
            where: { creditNote: { status: "VALIDATED" } },
            select: { quantity: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const grouped = new Map<string, ReturnableProduct>();
  for (const sale of sales) {
    for (const line of sale.lines) {
      const returned = line.creditNoteLines.reduce((sum, item) => sum + item.quantity, 0);
      const remaining = line.quantity - returned;
      const unitPrice = line.unitPriceHT.toNumber();
      const current = grouped.get(line.productId) ?? {
        productId: line.productId,
        productName: line.product.name,
        productReference: line.product.reference,
        totalBought: 0,
        alreadyReturned: 0,
        returnableQuantity: 0,
        lastPurchaseDate: sale.createdAt.toISOString(),
        invoicesCount: 0,
        prices: [],
        origins: [],
      };

      current.totalBought += line.quantity;
      current.alreadyReturned += returned;
      current.returnableQuantity += Math.max(0, remaining);
      current.lastPurchaseDate =
        sale.createdAt > new Date(current.lastPurchaseDate)
          ? sale.createdAt.toISOString()
          : current.lastPurchaseDate;
      if (!current.prices.includes(unitPrice)) current.prices.push(unitPrice);
      current.origins.push({
        saleId: sale.id,
        saleLineId: line.id,
        invoiceNumber: sale.invoiceNumber,
        saleDate: sale.createdAt.toISOString(),
        stockLocationId: sale.stockLocationId,
        stockLocationName: sale.stockLocation.name,
        quantityBought: line.quantity,
        quantityAlreadyReturned: returned,
        quantityReturnable: Math.max(0, remaining),
        unitPrice,
        discountPercent: line.discountRate.toNumber(),
        taxRate: line.taxRate.toNumber(),
      });
      current.invoicesCount = new Set(current.origins.map((origin) => origin.saleId)).size;
      grouped.set(line.productId, current);
    }
  }

  return [...grouped.values()]
    .map((product) => ({
      ...product,
      prices: product.prices.sort((a, b) => a - b),
      origins: product.origins
        .filter((origin) => origin.quantityReturnable > 0)
        .sort((a, b) => new Date(a.saleDate).getTime() - new Date(b.saleDate).getTime()),
    }))
    .filter((product) => product.returnableQuantity > 0);
}

function normalizeManualLines(lines: CreateCreditNoteInput["lines"]) {
  // Grouped by productId + saleLineId (not productId alone): two lines
  // returning the same product against two DIFFERENT original sales must
  // stay distinct, each capped against its own saleLineId independently -
  // merging them would let one line's cap silently absorb the other's.
  const grouped = new Map<string, z.infer<typeof manualCreditNoteLineSchema>>();

  for (const line of lines) {
    const parsed = manualCreditNoteLineSchema.parse(line);
    const key = `${parsed.productId}::${parsed.saleLineId ?? ""}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, parsed);
      continue;
    }

    grouped.set(key, {
      ...parsed,
      quantityReturned: existing.quantityReturned + parsed.quantityReturned,
      unitPrice: parsed.unitPrice ?? existing.unitPrice,
      discountPercent: parsed.discountPercent ?? existing.discountPercent,
      taxRate: parsed.taxRate ?? existing.taxRate,
    });
  }

  return [...grouped.values()];
}

// F8-B: same exact rounding points as before (grossHT/discountAmount stay
// raw intermediates, exactly like every other money-computation function
// already migrated - only the steps the old code already wrapped in
// roundMoney are now computed with subtractMoney/multiplyMoney/addMoney
// instead, which round on the value's own decimal digits rather than via
// `Math.round(x*100)/100`). No new rounding point was introduced, so every
// case where the old float arithmetic already happened to be correct
// produces an identical result - see the F8-B report's non-regression
// section.
// F8-D: the single choke point for every fresh credit-note money
// computation in this file (manual creation, draft, driver return - see
// resolveReturnLines below, itself called by all of them before any write).
// Checking here once, before rounding/further use, covers every call site
// without needing a check at each one - grossHT especially, since a
// large-but-otherwise-valid quantityReturned times a large unitPrice is
// exactly the case a bound on quantity alone would miss (see
// lib/money.ts#isWithinMoneyRange).
function computeLineTotals(line: CreditNoteLine) {
  const grossHT = line.unitPrice * line.quantityReturned;
  assertMoneyRange(line.unitPrice, "line.unitPrice");
  assertMoneyRange(grossHT, "line.grossHT");
  const discountAmount = grossHT * (line.discountPercent / 100);
  const totalHT = subtractMoney(grossHT, discountAmount);
  const taxAmount = multiplyMoney(totalHT, line.taxRate / 100);
  const totalTTC = addMoney(totalHT, taxAmount);
  assertMoneyRange(discountAmount, "line.discountAmount");
  assertMoneyRange(totalHT, "line.totalHT");
  assertMoneyRange(taxAmount, "line.taxAmount");
  assertMoneyRange(totalTTC, "line.totalTTC");

  return { totalHT, taxAmount, totalTTC };
}

// F8-D: aggregate totals, checked too - a note with many lines that are
// each individually in range could still sum past the limit.
function computeTotals(lines: PersistedLine[]) {
  const totals = {
    totalHT: addMoney(...lines.map((line) => line.totalHT)),
    taxAmount: addMoney(...lines.map((line) => line.taxAmount)),
    totalTTC: addMoney(...lines.map((line) => line.totalTTC)),
  };
  assertMoneyRange(totals.totalHT, "creditNote.subtotalHT");
  assertMoneyRange(totals.taxAmount, "creditNote.taxAmount");
  assertMoneyRange(totals.totalTTC, "creditNote.totalTTC");
  return totals;
}

async function nextCreditNoteNumber(
  tx: Pick<typeof prisma, "creditNote" | "$queryRaw">,
  organizationId: string,
  date: Date,
  partyType: CreditNotePartyType,
) {
  const scopeDate = formatSequenceDate(date);
  const prefix = `${partyType === "fournisseur" ? "AF" : "AC"}-${scopeDate}-`;
  const number = await reserveDocumentSequence(
    tx,
    organizationId,
    partyType === "fournisseur" ? DocumentType.CreditNoteSupplier : DocumentType.CreditNoteClient,
    scopeDate,
  );
  return `${prefix}${String(number).padStart(6, "0")}`;
}

async function nextMovementNumber(
  tx: Pick<typeof prisma, "stockMovement" | "$queryRaw">,
  organizationId: string,
  date: Date,
) {
  const scopeDate = formatSequenceDate(date);
  const prefix = `MV-${scopeDate}-`;
  const number = await reserveDocumentSequence(
    tx,
    organizationId,
    DocumentType.StockMovementDated,
    scopeDate,
  );
  return `${prefix}${String(number).padStart(6, "0")}`;
}

function parseReturnDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new OperationsServiceError("La date de retour est invalide.", 422);
  }
  return date;
}

function formatSequenceDate(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withSerializableRetry<T>(operation: () => Promise<T>, maxAttempts = 40): Promise<T> {
  let attempt = 0;

  while (attempt < maxAttempts) {
    try {
      return await operation();
    } catch (error) {
      const prismaError = error as { code?: string; message?: string };
      attempt += 1;
      const isRetryable =
        prismaError.code === "P2034" ||
        (prismaError.code === "P2010" &&
          /40001|40P01/.test(prismaError.message ?? ""));
      if (!isRetryable || attempt >= maxAttempts) {
        throw error;
      }
      // Jittered backoff: under N-way true-simultaneous contention on the
      // same counter row, retrying instantly just re-collides with the same
      // herd (empirically verified: without this, 50-100-way concurrent
      // reserveDocumentSequence() calls exhausted immediate retries - see
      // scripts/_tmp-test-real-generators.ts in the Phase 3 numbering
      // chantier report).
      await sleep(Math.min(800, 10 * 1.5 ** attempt) * (0.5 + Math.random()));
    }
  }

  throw new OperationsServiceError("Impossible de finaliser l'operation.", 500);
}

// Separate, wider-retrying variant used only by persistManualCreditNote's
// idempotency-guarded create path (F5): retries P2002 as well as P2034, so
// the unique index on (organizationId, idempotencyKey) genuinely acts as the
// last line of defense under true simultaneous requests carrying the same
// key - the retried attempt's find-by-key check will then see the row the
// other request just committed and return it, instead of surfacing the
// conflict as an error. Deliberately NOT merged into withSerializableRetry
// above, which stays P2034-only and keeps its existing behavior unchanged
// for validateCreditNote/reverseCreditNote.
async function withIdempotentSerializableRetry<T>(operation: () => Promise<T>, maxAttempts = 40): Promise<T> {
  let attempt = 0;

  while (attempt < maxAttempts) {
    try {
      return await operation();
    } catch (error) {
      const prismaError = error as { code?: string; message?: string };
      attempt += 1;
      const isRetryable =
        ["P2002", "P2034"].includes(prismaError.code ?? "") ||
        (prismaError.code === "P2010" &&
          /40001|40P01/.test(prismaError.message ?? ""));
      if (!isRetryable || attempt >= maxAttempts) {
        throw error;
      }
      // Jittered backoff: under N-way true-simultaneous contention on the
      // same counter row, retrying instantly just re-collides with the same
      // herd (empirically verified: without this, 50-100-way concurrent
      // reserveDocumentSequence() calls exhausted immediate retries - see
      // scripts/_tmp-test-real-generators.ts in the Phase 3 numbering
      // chantier report).
      await sleep(Math.min(800, 10 * 1.5 ** attempt) * (0.5 + Math.random()));
    }
  }

  throw new OperationsServiceError("Impossible de finaliser l'avoir.", 500);
}
