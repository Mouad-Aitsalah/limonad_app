import "server-only";

import { z } from "zod";

import { Prisma } from "@/lib/generated/prisma/client";
import type { PurchaseGetPayload } from "@/lib/generated/prisma/models/Purchase";
import { prisma } from "@/lib/prisma";
import { postPurchaseAccountingEntry } from "@/lib/server/accounting";
import { requireSessionUser } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { nextMovementNumber, roundMoney } from "@/lib/server/sales-shared";
import type { Purchase, PurchasePaymentMethod, PurchaseStatus } from "@/types/purchase";

const purchasePaymentMethods = [
  "especes",
  "carte",
  "cheque",
  "virement",
  "credit_fournisseur",
] as const;

const purchaseSchema = z.object({
  date: z.string().trim().min(1, "La date est obligatoire."),
  fournisseurId: z.string().trim().min(1, "Le fournisseur est obligatoire."),
  modeReglement: z.enum(purchasePaymentMethods),
  numeroCheque: z.string().trim().nullable().optional(),
  banque: z.string().trim().nullable().optional(),
  datePaiement: z.string().trim().nullable().optional(),
  observation: z.string().trim().nullable().optional(),
  lignes: z
    .array(
      z.object({
        productId: z.string().trim().min(1, "Le produit est obligatoire."),
        quantite: z.coerce.number().int().positive("La quantite doit etre positive."),
        prixAchat: z.coerce.number().positive("Le prix d'achat doit etre positif."),
        remisePercent: z.coerce.number().min(0).max(100).optional().default(0),
      }),
    )
    .min(1, "Ajoutez au moins un produit."),
});

const purchaseInclude = {
  supplier: { select: { id: true, name: true } },
  createdBy: { select: { id: true, fullName: true } },
  lines: {
    include: {
      product: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  },
} as const;

type PurchaseWithRelations = PurchaseGetPayload<{ include: typeof purchaseInclude }>;

export async function getPurchases(): Promise<Purchase[]> {
  const purchases = await prisma.purchase.findMany({
    include: purchaseInclude,
    orderBy: [{ createdAt: "desc" }, { purchaseNumber: "desc" }],
  });

  return purchases.map(mapPurchaseToDto);
}

export async function createPurchase(input: unknown): Promise<Purchase> {
  const sessionUser = await requireSessionUser(["admin", "depot_manager", "cashier"]);
  const parsed = purchaseSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationsServiceError(
      "Certains champs sont invalides.",
      422,
      Object.fromEntries(
        parsed.error.issues.map((issue) => [
          issue.path.join(".") || "form",
          issue.message,
        ]),
      ),
    );
  }

  const normalizedLines = normalizeLines(parsed.data.lignes);
  const orderDate = parsePurchaseDate(parsed.data.date);
  const paymentDate = parsed.data.datePaiement
    ? parsePurchaseDate(parsed.data.datePaiement)
    : null;

  const created = await prisma.$transaction(
    async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: sessionUser.id },
        select: {
          id: true,
          depotId: true,
          depot: { select: { id: true, active: true } },
        },
      });
      if (!user?.depotId || !user.depot?.active) {
        throw new OperationsServiceError(
          "Aucun depot actif n'est rattache a cet utilisateur.",
          409,
        );
      }

      const [supplier, stockLocation, products] = await Promise.all([
        tx.supplier.findUnique({
          where: { id: parsed.data.fournisseurId },
          select: { id: true, active: true },
        }),
        tx.stockLocation.findUnique({
          where: { depotId: user.depotId },
          select: { id: true, active: true, type: true },
        }),
        tx.product.findMany({
          where: {
            id: { in: normalizedLines.map((line) => line.productId) },
            status: "ACTIVE",
          },
          select: { id: true, taxRate: true },
        }),
      ]);

      if (!supplier) throw new OperationsServiceError("Fournisseur introuvable.", 404);
      if (!supplier.active) throw new OperationsServiceError("Fournisseur inactif.", 409);
      if (!stockLocation || stockLocation.type !== "DEPOT" || !stockLocation.active) {
        throw new OperationsServiceError("Emplacement depot introuvable.", 404);
      }
      if (products.length !== normalizedLines.length) {
        throw new OperationsServiceError("Un produit est introuvable ou inactif.", 422);
      }

      const productById = new Map(products.map((product) => [product.id, product]));
      const computedLines = normalizedLines.map((line) => {
        const product = productById.get(line.productId);
        if (!product) throw new OperationsServiceError("Produit introuvable.", 422);

        const grossHT = line.prixAchat * line.quantite;
        const discountAmount = roundMoney(grossHT * (line.remisePercent / 100));
        const totalHT = roundMoney(grossHT - discountAmount);
        const taxRate = product.taxRate.toNumber();
        const taxAmount = roundMoney(totalHT * (taxRate / 100));

        return {
          ...line,
          taxRate,
          taxAmount,
          totalHT,
          totalTTC: roundMoney(totalHT + taxAmount),
        };
      });
      const subtotalHT = roundMoney(
        computedLines.reduce((sum, line) => sum + line.totalHT, 0),
      );
      const taxAmount = roundMoney(
        computedLines.reduce((sum, line) => sum + line.taxAmount, 0),
      );
      const totalTTC = roundMoney(subtotalHT + taxAmount);
      const purchaseNumber = await nextPurchaseNumber(tx);

      const purchase = await tx.purchase.create({
        data: {
          purchaseNumber,
          supplierId: supplier.id,
          depotId: user.depotId,
          status: "RECEIVED",
          orderDate,
          receivedAt: orderDate,
          paymentMethod: parsed.data.modeReglement,
          paymentDate,
          chequeNumber:
            parsed.data.modeReglement === "cheque"
              ? parsed.data.numeroCheque?.trim() || null
              : null,
          bankName:
            parsed.data.modeReglement === "cheque"
              ? parsed.data.banque?.trim() || null
              : null,
          observation: parsed.data.observation?.trim() || null,
          subtotalHT,
          taxAmount,
          totalTTC,
          createdByUserId: user.id,
          validatedByUserId: user.id,
          lines: {
            create: computedLines.map((line) => ({
              productId: line.productId,
              orderedQuantity: line.quantite,
              receivedQuantity: line.quantite,
              unitPurchasePrice: line.prixAchat,
              discountRate: line.remisePercent,
              taxRate: line.taxRate,
              taxAmount: line.taxAmount,
              totalHT: line.totalHT,
              totalTTC: line.totalTTC,
            })),
          },
        },
        include: purchaseInclude,
      });

      for (const line of computedLines) {
        const current = await tx.stockLevel.upsert({
          where: {
            productId_locationId: {
              productId: line.productId,
              locationId: stockLocation.id,
            },
          },
          update: {},
          create: {
            productId: line.productId,
            locationId: stockLocation.id,
            quantity: 0,
            reservedQuantity: 0,
          },
        });
        const nextQuantity = current.quantity + line.quantite;

        await tx.stockLevel.update({
          where: { id: current.id },
          data: { quantity: nextQuantity },
        });

        await tx.stockMovement.create({
          data: {
            movementNumber: await nextMovementNumber(tx),
            type: "PURCHASE_ENTRY",
            productId: line.productId,
            quantity: line.quantite,
            sourceLocationId: null,
            destinationLocationId: stockLocation.id,
            referenceType: "PURCHASE",
            referenceId: purchase.id,
            reason: `Achat ${purchase.purchaseNumber}`,
            note: buildPurchaseMovementNote({
              beforeQuantity: current.quantity,
              afterQuantity: nextQuantity,
            }),
            createdByUserId: user.id,
            status: "VALIDATED",
          },
        });
      }

      await postPurchaseAccountingEntry(tx, {
        purchaseId: purchase.id,
        purchaseNumber: purchase.purchaseNumber,
        supplierId: purchase.supplierId,
        date: orderDate,
        subtotalHT,
        taxAmount,
        totalTTC,
        paymentMethod: parsed.data.modeReglement,
        createdByUserId: user.id,
      });

      return purchase;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  return mapPurchaseToDto(created);
}

function mapPurchaseToDto(purchase: PurchaseWithRelations): Purchase {
  return {
    id: purchase.id,
    numero: purchase.purchaseNumber,
    date: purchase.orderDate,
    fournisseurId: purchase.supplierId,
    fournisseurNom: purchase.supplier.name,
    modeReglement: mapPaymentMethod(purchase.paymentMethod),
    numeroCheque: purchase.chequeNumber,
    banque: purchase.bankName,
    datePaiement: purchase.paymentDate,
    utilisateurId: purchase.createdByUserId,
    utilisateurNom: purchase.createdBy.fullName,
    observation: purchase.observation ?? "",
    statut: mapPurchaseStatus(purchase.status),
    lignes: purchase.lines.map((line) => ({
      productId: line.productId,
      productName: line.product.name,
      quantite: line.receivedQuantity || line.orderedQuantity,
      prixAchat: line.unitPurchasePrice.toNumber(),
      remisePercent: line.discountRate.toNumber(),
      tauxTVA: line.taxRate.toNumber(),
      totalHT: line.totalHT.toNumber(),
      totalTVA: line.taxAmount.toNumber(),
      totalTTC: line.totalTTC.toNumber(),
    })),
    createdAt: purchase.createdAt,
    updatedAt: purchase.updatedAt,
  };
}

function normalizeLines(lines: z.infer<typeof purchaseSchema>["lignes"]) {
  const seen = new Set<string>();
  return lines.map((line) => {
    if (seen.has(line.productId)) {
      throw new OperationsServiceError("Un produit ne peut apparaitre qu'une fois.", 422);
    }
    seen.add(line.productId);
    return {
      ...line,
      remisePercent: line.remisePercent ?? 0,
    };
  });
}

async function nextPurchaseNumber(tx: Prisma.TransactionClient) {
  const last = await tx.purchase.findFirst({
    where: { purchaseNumber: { startsWith: "A-" } },
    orderBy: { purchaseNumber: "desc" },
    select: { purchaseNumber: true },
  });
  const lastSuffix = last?.purchaseNumber.match(/A-(\d{6})$/)?.[1];
  const next = (lastSuffix ? Number(lastSuffix) : 0) + 1;
  return `A-${String(next).padStart(6, "0")}`;
}

function parsePurchaseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) {
    throw new OperationsServiceError("Date d'achat invalide.", 422);
  }
  return date;
}

function mapPurchaseStatus(status: string): PurchaseStatus {
  if (status === "RECEIVED") return "validee";
  if (status === "CANCELLED") return "annulee";
  return "en_attente";
}

function mapPaymentMethod(value: string): PurchasePaymentMethod {
  if (purchasePaymentMethods.includes(value as PurchasePaymentMethod)) {
    return value as PurchasePaymentMethod;
  }
  return "credit_fournisseur";
}

function buildPurchaseMovementNote({
  beforeQuantity,
  afterQuantity,
}: {
  beforeQuantity: number;
  afterQuantity: number;
}) {
  return `PURCHASE_RECEIPT_SNAPSHOT:${JSON.stringify({
    beforeQuantity,
    afterQuantity,
    deltaQuantity: afterQuantity - beforeQuantity,
  })}`;
}
