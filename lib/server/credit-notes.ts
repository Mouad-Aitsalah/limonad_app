import "server-only";

import { z } from "zod";

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
import { OperationsServiceError } from "@/lib/server/depots";
import {
  asOrganizationUser,
  requireOrganizationUser,
} from "@/lib/server/organization-context";
import type { CurrentUser } from "@/types/auth";
import type {
  CreateCreditNoteInput,
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
  createdBy: { select: { fullName: true } },
  validatedBy: { select: { fullName: true } },
  lines: {
    include: {
      product: { select: { reference: true, name: true } },
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
  quantityReturned: z.coerce
    .number()
    .int("La quantite doit etre un entier.")
    .positive("La quantite retournee doit etre superieure a zero."),
  unitPrice: z.coerce.number().min(0, "Le prix de reprise doit etre positif.").optional(),
  discountPercent: z.coerce
    .number()
    .min(0, "La remise doit etre positive.")
    .max(100, "La remise ne peut pas depasser 100%.")
    .optional(),
  taxRate: z.coerce.number().min(0, "La TVA doit etre positive.").optional(),
});

export const createCreditNoteSchema = z.object({
  id: z.string().trim().optional(),
  partyType: z.enum(["client", "fournisseur"]).default("client"),
  customerId: z.string().trim().nullable().optional(),
  supplierId: z.string().trim().nullable().optional(),
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
      { isolationLevel: "Serializable" },
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

        if (note.partyType === "CUSTOMER") {
          if (!note.stockDestinationLocationId) {
            throw new OperationsServiceError("Destination de stock introuvable.", 422);
          }

          for (const line of note.lines) {
            const level = await tx.stockLevel.findUnique({
              where: {
                productId_locationId: {
                  productId: line.productId,
                  locationId: note.stockDestinationLocationId,
                },
              },
              select: { quantity: true },
            });

            if (!level || level.quantity < line.quantity) {
              throw new OperationsServiceError(
                `Stock insuffisant pour contre-passer ${line.product.name}.`,
                422,
              );
            }
          }

          for (const line of note.lines) {
            await tx.stockLevel.update({
              where: {
                productId_locationId: {
                  productId: line.productId,
                  locationId: note.stockDestinationLocationId,
                },
              },
              data: {
                quantity: { decrement: line.quantity },
              },
            });

            await tx.stockMovement.create({
              data: {
                organizationId: user.organizationId,
                movementNumber: await nextMovementNumber(
                  tx,
                  user.organizationId,
                  new Date(),
                ),
                type: "REVERSAL",
                productId: line.productId,
                quantity: line.quantity,
                sourceLocationId: note.stockDestinationLocationId,
                destinationLocationId: null,
                referenceType: "CREDIT_NOTE_REVERSAL",
                referenceId: note.id,
                reason: `Contre-passation avoir ${note.creditNoteNumber}`,
                note: note.comment || null,
                createdByUserId: user.id,
                status: "VALIDATED",
              },
            });
          }
        } else {
          if (!note.stockSourceLocationId) {
            throw new OperationsServiceError("Stock source introuvable.", 422);
          }

          for (const line of note.lines) {
            await tx.stockLevel.upsert({
              where: {
                productId_locationId: {
                  productId: line.productId,
                  locationId: note.stockSourceLocationId,
                },
              },
              update: {
                quantity: { increment: line.quantity },
              },
              create: {
                organizationId: user.organizationId,
                productId: line.productId,
                locationId: note.stockSourceLocationId,
                quantity: line.quantity,
                reservedQuantity: 0,
              },
            });

            await tx.stockMovement.create({
              data: {
                organizationId: user.organizationId,
                movementNumber: await nextMovementNumber(
                  tx,
                  user.organizationId,
                  new Date(),
                ),
                type: "REVERSAL",
                productId: line.productId,
                quantity: line.quantity,
                sourceLocationId: null,
                destinationLocationId: note.stockSourceLocationId,
                referenceType: "CREDIT_NOTE_REVERSAL",
                referenceId: note.id,
                reason: `Contre-passation avoir ${note.creditNoteNumber}`,
                note: note.comment || null,
                createdByUserId: user.id,
                status: "VALIDATED",
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
      { isolationLevel: "Serializable" },
    ),
  );
}

export async function getReturnableProductsForCustomer(
  customerId: string,
): Promise<ReturnableProduct[]> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  return computeReturnableProducts(currentUser.organizationId, customerId);
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

  return withSerializableRetry(async () =>
    prisma.$transaction(
      async (tx) => {
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

        const [customer, supplier, destination, sourceLocation, products] = await Promise.all([
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
          tx.product.findMany({
            where: {
              id: { in: normalizedLines.map((line) => line.productId) },
              organizationId: user.organizationId,
            },
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
          }),
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

        const productMap = new Map(products.map((product) => [product.id, product]));
        const persistedLines = normalizedLines.map((line) => {
          const product = productMap.get(line.productId);
          if (!product || product.status !== "ACTIVE") {
            throw new OperationsServiceError("Un produit selectionne est introuvable ou inactif.", 422);
          }
          if (
            partyType === "fournisseur" &&
            supplierId &&
            product.defaultSupplierId &&
            product.defaultSupplierId !== supplierId
          ) {
            throw new OperationsServiceError(
              `Le produit ${product.name} n'est pas rattache a ce fournisseur.`,
              422,
            );
          }

          const unitPrice =
            line.unitPrice ?? (partyType === "fournisseur" ? product.purchasePrice.toNumber() : product.salePrice.toNumber());
          const discountPercent = line.discountPercent ?? 0;
          const taxRate = line.taxRate ?? product.taxRate.toNumber();
          const totals = computeLineTotals({
            productId: line.productId,
            quantityReturned: line.quantityReturned,
            unitPrice,
            discountPercent,
            taxRate,
          });

          return {
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
          };
        });

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
              origin: "MANUAL",
              originalSaleId: null,
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
              saleLineId: null,
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
              originalSaleId: null,
              partyType: partyTypeToPrisma[partyType],
              customerId,
              supplierId,
              status: statusToPrisma[status],
              origin: "MANUAL",
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
              lines: {
                create: persistedLines.map((line) => ({
                  saleLineId: null,
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
            },
          },
        });

        return note;
      },
      { isolationLevel: "Serializable" },
    ),
  ).then((note) => mapCreditNoteToDto(note));
}

async function applyValidationSideEffects(
  tx: Pick<typeof prisma, "stockLevel" | "stockMovement">,
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
          creditNoteLines: {
            where: { creditNote: { status: { not: "REVERSED" } } },
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
  const grouped = new Map<string, z.infer<typeof manualCreditNoteLineSchema>>();

  for (const line of lines) {
    const parsed = manualCreditNoteLineSchema.parse(line);
    const existing = grouped.get(parsed.productId);
    if (!existing) {
      grouped.set(parsed.productId, parsed);
      continue;
    }

    grouped.set(parsed.productId, {
      ...parsed,
      quantityReturned: existing.quantityReturned + parsed.quantityReturned,
      unitPrice: parsed.unitPrice ?? existing.unitPrice,
      discountPercent: parsed.discountPercent ?? existing.discountPercent,
      taxRate: parsed.taxRate ?? existing.taxRate,
    });
  }

  return [...grouped.values()];
}

function computeLineTotals(line: CreditNoteLine) {
  const grossHT = line.unitPrice * line.quantityReturned;
  const discountAmount = grossHT * (line.discountPercent / 100);
  const totalHT = roundMoney(grossHT - discountAmount);
  const taxAmount = roundMoney(totalHT * (line.taxRate / 100));
  const totalTTC = roundMoney(totalHT + taxAmount);

  return { totalHT, taxAmount, totalTTC };
}

function computeTotals(lines: PersistedLine[]) {
  return {
    totalHT: roundMoney(lines.reduce((sum, line) => sum + line.totalHT, 0)),
    taxAmount: roundMoney(lines.reduce((sum, line) => sum + line.taxAmount, 0)),
    totalTTC: roundMoney(lines.reduce((sum, line) => sum + line.totalTTC, 0)),
  };
}

async function nextCreditNoteNumber(
  tx: Pick<typeof prisma, "creditNote">,
  organizationId: string,
  date: Date,
  partyType: CreditNotePartyType,
) {
  const prefix = `${partyType === "fournisseur" ? "AF" : "AC"}-${formatSequenceDate(date)}-`;
  const last = await tx.creditNote.findFirst({
    where: {
      organizationId,
      creditNoteNumber: { startsWith: prefix },
    },
    orderBy: { creditNoteNumber: "desc" },
    select: { creditNoteNumber: true },
  });

  const lastSequence = Number(last?.creditNoteNumber.slice(prefix.length) ?? "0");
  return `${prefix}${String(lastSequence + 1).padStart(6, "0")}`;
}

async function nextMovementNumber(
  tx: Pick<typeof prisma, "stockMovement">,
  organizationId: string,
  date: Date,
) {
  const prefix = `MV-${formatSequenceDate(date)}-`;
  const last = await tx.stockMovement.findFirst({
    where: {
      organizationId,
      movementNumber: { startsWith: prefix },
    },
    orderBy: { movementNumber: "desc" },
    select: { movementNumber: true },
  });

  const lastSequence = Number(last?.movementNumber.slice(prefix.length) ?? "0");
  return `${prefix}${String(lastSequence + 1).padStart(6, "0")}`;
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

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

async function withSerializableRetry<T>(operation: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let attempt = 0;

  while (attempt < maxAttempts) {
    try {
      return await operation();
    } catch (error) {
      const prismaError = error as { code?: string };
      attempt += 1;
      if (prismaError.code !== "P2034" || attempt >= maxAttempts) {
        throw error;
      }
    }
  }

  throw new OperationsServiceError("Impossible de finaliser l'operation.", 500);
}
