import "server-only";

import { z } from "zod";

import { Prisma } from "@/lib/generated/prisma/client";
import type { PurchaseGetPayload } from "@/lib/generated/prisma/models/Purchase";
import { MONEY_RANGE_MAX_NUMBER } from "@/lib/money";
import {
  calculateDoubleDiscountPrice,
  computeDoubleDiscountLine,
} from "@/lib/purchase-pricing";
import { prisma } from "@/lib/prisma";
import { postPurchaseAccountingEntry } from "@/lib/server/accounting";
import { assertMoneyRange, OperationsServiceError } from "@/lib/server/depots";
import { DocumentType, reserveDocumentSequence } from "@/lib/server/document-sequence";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import { nextMovementNumber, roundMoney } from "@/lib/server/sales-shared";
import type { Purchase, PurchasePaymentMethod, PurchaseStatus } from "@/types/purchase";

const purchasePaymentMethods = [
  "especes",
  "banque",
  "carte",
  "cheque",
  "virement",
  "credit_fournisseur",
] as const;

// Sanity-bounded % (0..100). NaN / <0 / >100 are rejected up front.
const percentSchema = z.coerce.number().min(0).max(100).optional().default(0);
// F8-D: input-level sanity bounds only, not the real protection - a
// plausible quantity times a plausible price can still overflow once
// multiplied together (see assertMoneyRange calls, the actual gate).
const quantiteSchema = z.coerce
  .number()
  .int()
  .positive("La quantite doit etre positive.")
  .max(1_000_000);

// CLASSIC_TTC line: tax-INCLUDED unit price + one % discount. HT / VAT are
// derived server-side (computedLines map below) - unchanged behaviour.
const classicLineSchema = z.object({
  productId: z.string().trim().min(1, "Le produit est obligatoire."),
  quantite: quantiteSchema,
  prixAchatTTC: z.coerce
    .number()
    .positive("Le prix d'achat doit etre positif.")
    .max(MONEY_RANGE_MAX_NUMBER),
  remisePercent: percentSchema,
});

// DOUBLE_DISCOUNT_HT line: gross HT unit price (prefilled from
// Product.purchasePrice, editable) + two SUCCESSIVE discounts. Net HT / VAT /
// TTC are derived server-side via computeDoubleDiscountLine.
const doubleDiscountLineSchema = z.object({
  productId: z.string().trim().min(1, "Le produit est obligatoire."),
  quantite: quantiteSchema,
  prixBrutHT: z.coerce
    .number()
    .positive("Le prix brut HT doit etre positif.")
    .max(MONEY_RANGE_MAX_NUMBER),
  remise1Percent: percentSchema,
  remise2Percent: percentSchema,
});

const purchaseBaseSchema = z.object({
  date: z.string().trim().min(1, "La date est obligatoire."),
  fournisseurId: z.string().trim().min(1, "Le fournisseur est obligatoire."),
  modeReglement: z.enum(purchasePaymentMethods),
  numeroCheque: z.string().trim().nullable().optional(),
  banque: z.string().trim().nullable().optional(),
  bankAccountingAccountId: z.string().trim().nullable().optional(),
  datePaiement: z.string().trim().nullable().optional(),
  observation: z.string().trim().nullable().optional(),
});

// A caller that never sends `pricingMode` (old client, external script) keeps
// today's behaviour exactly: CLASSIC_TTC.
const purchaseSchema = z.preprocess(
  (value) => {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !("pricingMode" in value)
    ) {
      return { ...value, pricingMode: "CLASSIC_TTC" };
    }
    return value;
  },
  z.discriminatedUnion("pricingMode", [
    purchaseBaseSchema.extend({
      pricingMode: z.literal("CLASSIC_TTC"),
      lignes: z.array(classicLineSchema).min(1, "Ajoutez au moins un produit."),
    }),
    purchaseBaseSchema.extend({
      pricingMode: z.literal("DOUBLE_DISCOUNT_HT"),
      lignes: z
        .array(doubleDiscountLineSchema)
        .min(1, "Ajoutez au moins un produit."),
    }),
  ]),
);

type ComputedPurchaseLine = {
  productId: string;
  quantite: number;
  unitPurchasePriceHT: number;
  discountRate: number;
  discountRate2: number;
  taxRate: number;
  taxAmount: number;
  totalHT: number;
  totalTTC: number;
};

const purchaseInclude = {
  supplier: { select: { id: true, name: true } },
  createdBy: { select: { id: true, fullName: true } },
  bankAccountingAccount: { select: { id: true, code: true, name: true } },
  lines: {
    include: {
      product: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  },
} as const;

type PurchaseWithRelations = PurchaseGetPayload<{ include: typeof purchaseInclude }>;

export async function getPurchases(): Promise<Purchase[]> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const purchases = await prisma.purchase.findMany({
    where: { organizationId: currentUser.organizationId },
    include: purchaseInclude,
    orderBy: [{ createdAt: "desc" }, { purchaseNumber: "desc" }],
  });

  return purchases.map(mapPurchaseToDto);
}

export async function createPurchase(input: unknown): Promise<Purchase> {
  const sessionUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
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

  const productIds = parsed.data.lignes.map((line) => line.productId);
  if (new Set(productIds).size !== productIds.length) {
    throw new OperationsServiceError("Un produit ne peut apparaitre qu'une fois.", 422);
  }
  const orderDate = parsePurchaseDate(parsed.data.date);
  const paymentDate = parsed.data.datePaiement
    ? parsePurchaseDate(parsed.data.datePaiement)
    : null;

  // F10: read-then-write (nextPurchaseNumber counts existing rows, stock
  // levels are read fresh) - a retry after a Serializable conflict (P2034)
  // or a numbering race (P2002) simply re-reads current state and recomputes
  // a fresh number, never a duplicate purchase.
  const created = await withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
      const user = await tx.user.findFirst({
        where: {
          id: sessionUser.id,
          organizationId: sessionUser.organizationId,
        },
        select: {
          id: true,
          depotId: true,
          depot: { select: { id: true, active: true } },
        },
      });
      if (!user?.depotId || !user.depot?.active) {
        throw new OperationsServiceError(
          "Aucun depot actif n'est associe a votre compte. Contactez un administrateur.",
          409,
        );
      }

      const [supplier, stockLocation, products] = await Promise.all([
        tx.supplier.findFirst({
          where: {
            id: parsed.data.fournisseurId,
            organizationId: sessionUser.organizationId,
          },
          select: { id: true, active: true },
        }),
        tx.stockLocation.findFirst({
          where: {
            depotId: user.depotId,
            organizationId: sessionUser.organizationId,
          },
          select: { id: true, active: true, type: true },
        }),
        tx.product.findMany({
          where: {
            id: { in: productIds },
            organizationId: sessionUser.organizationId,
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
      if (products.length !== productIds.length) {
        throw new OperationsServiceError("Un produit est introuvable ou inactif.", 422);
      }

      let bankAccountingAccountId: string | null = null;
      if (parsed.data.modeReglement === "banque") {
        const requestedAccountId = parsed.data.bankAccountingAccountId?.trim();
        if (!requestedAccountId) {
          throw new OperationsServiceError("Le compte bancaire 5141 est obligatoire.", 422, {
            bankAccountingAccountId: "Le compte bancaire 5141 est obligatoire.",
          });
        }
        const bankAccount = await tx.accountingAccount.findFirst({
          where: {
            id: requestedAccountId,
            organizationId: sessionUser.organizationId,
            isActive: true,
            code: { startsWith: "5141" },
          },
          select: { id: true },
        });
        if (!bankAccount) {
          throw new OperationsServiceError(
            "Le compte bancaire sélectionné est introuvable, inactif ou non autorisé.",
            422,
            { bankAccountingAccountId: "Sélectionnez un compte bancaire 5141 actif." },
          );
        }
        bankAccountingAccountId = bankAccount.id;
      }

      const productById = new Map(products.map((product) => [product.id, product]));
      const taxRateFor = (productId: string) => {
        const product = productById.get(productId);
        if (!product) throw new OperationsServiceError("Produit introuvable.", 422);
        return product.taxRate.toNumber();
      };

      // Two mutually-exclusive derivations, branched once on the purchase's
      // pricing mode (never per line - a purchase is entirely one mode).
      const computedLines: ComputedPurchaseLine[] =
        parsed.data.pricingMode === "DOUBLE_DISCOUNT_HT"
          ? parsed.data.lignes.map((line) => {
              // Gross HT unit price + two SUCCESSIVE discounts (discount 2 on
              // the RESULT of discount 1, never their sum). Net HT is the line
              // HT; VAT is HT-first on that net. The accounting entry then
              // uses the NET aggregates below. See lib/purchase-pricing.ts.
              const taxRate = taxRateFor(line.productId);
              const grossHT = line.prixBrutHT;
              assertMoneyRange(grossHT, "line.prixBrutHT");
              const t = computeDoubleDiscountLine({
                quantite: line.quantite,
                grossHT,
                discount1: line.remise1Percent,
                discount2: line.remise2Percent,
                taxRate,
              });
              assertMoneyRange(t.totalHT, "line.totalHT");
              assertMoneyRange(t.taxAmount, "line.taxAmount");
              assertMoneyRange(t.totalTTC, "line.totalTTC");
              return {
                productId: line.productId,
                quantite: line.quantite,
                // The gross HT actually used (operator-editable) -
                // Product.purchasePrice is never written by a purchase.
                unitPurchasePriceHT: roundMoney(grossHT),
                discountRate: line.remise1Percent,
                discountRate2: line.remise2Percent,
                taxRate,
                taxAmount: t.taxAmount,
                totalHT: t.totalHT,
                totalTTC: t.totalTTC,
              };
            })
          : parsed.data.lignes.map((line) => {
              // CLASSIC_TTC - unchanged. The operator types the tax-included
              // unit price and a % discount on the TTC subtotal; HT and VAT
              // are derived so taxAmount is always totalTTC - totalHT.
              const taxRate = taxRateFor(line.productId);
              const grossTTC = line.prixAchatTTC * line.quantite;
              assertMoneyRange(line.prixAchatTTC, "line.prixAchatTTC");
              assertMoneyRange(grossTTC, "line.grossTTC");
              const discountAmount = roundMoney(
                grossTTC * (line.remisePercent / 100),
              );
              const totalTTC = roundMoney(grossTTC - discountAmount);
              const totalHT = roundMoney(totalTTC / (1 + taxRate / 100));
              const taxAmount = roundMoney(totalTTC - totalHT);
              const unitPurchasePriceHT = roundMoney(
                line.prixAchatTTC / (1 + taxRate / 100),
              );
              assertMoneyRange(discountAmount, "line.discountAmount");
              assertMoneyRange(totalHT, "line.totalHT");
              assertMoneyRange(taxAmount, "line.taxAmount");
              assertMoneyRange(totalTTC, "line.totalTTC");
              return {
                productId: line.productId,
                quantite: line.quantite,
                unitPurchasePriceHT,
                discountRate: line.remisePercent,
                discountRate2: 0,
                taxRate,
                taxAmount,
                totalHT,
                totalTTC,
              };
            });
      const subtotalHT = roundMoney(
        computedLines.reduce((sum, line) => sum + line.totalHT, 0),
      );
      const taxAmount = roundMoney(
        computedLines.reduce((sum, line) => sum + line.taxAmount, 0),
      );
      const totalTTC = roundMoney(subtotalHT + taxAmount);
      // F8-D: aggregate totals, checked before any write in this
      // transaction (purchase.create is the first one, just below).
      assertMoneyRange(subtotalHT, "subtotalHT");
      assertMoneyRange(taxAmount, "taxAmount");
      assertMoneyRange(totalTTC, "totalTTC");
      const purchaseNumber = await nextPurchaseNumber(tx, sessionUser.organizationId);

      const purchase = await tx.purchase.create({
        data: {
          organizationId: sessionUser.organizationId,
          purchaseNumber,
          supplierId: supplier.id,
          depotId: user.depotId,
          status: "RECEIVED",
          pricingMode: parsed.data.pricingMode,
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
          bankAccountingAccountId,
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
              unitPurchasePrice: line.unitPurchasePriceHT,
              discountRate: line.discountRate,
              discountRate2: line.discountRate2,
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
            organizationId: sessionUser.organizationId,
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
            organizationId: sessionUser.organizationId,
            movementNumber: await nextMovementNumber(tx, sessionUser.organizationId),
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
        organizationId: sessionUser.organizationId,
        purchaseId: purchase.id,
        purchaseNumber: purchase.purchaseNumber,
        supplierId: purchase.supplierId,
        date: orderDate,
        subtotalHT,
        taxAmount,
        totalTTC,
        paymentMethod: parsed.data.modeReglement,
        bankAccountingAccountId,
        createdByUserId: user.id,
      });

      return purchase;
      },
      // 15s: same fix already applied to counter-sales.ts / driver-sales.ts /
      // credit-notes.ts / tours.ts / inventories.ts's equivalent transactions
      // - this one chains several sequential lookups plus accounting
      // bootstrap/posting (ensureAccountingBootstrap, requireSettings, the
      // invoice-entry and settlement-entry lookups in
      // postPurchaseAccountingEntry), which can exceed Prisma's 5s default
      // interactive-transaction timeout (P2028) against Neon's serverless
      // connection latency, even with no real conflict. Found live while
      // testing F8 fix #1 (unrelated to that fix itself - this transaction
      // was already this slow before it, the VAT-line change just happened
      // to be what first exercised the purchase flow end-to-end in this
      // session).
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 },
    ),
  );

  return mapPurchaseToDto(created);
}

// F10: same shape as every other file's local withSerializableRetry in
// this codebase (counter-sales.ts, credit-notes.ts, tours.ts, etc.).
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

  throw new OperationsServiceError("Impossible d'enregistrer l'achat.", 500);
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
    bankAccountingAccountId: purchase.bankAccountingAccountId,
    bankAccountingAccountCode: purchase.bankAccountingAccount?.code ?? null,
    bankAccountingAccountName: purchase.bankAccountingAccount?.name ?? null,
    datePaiement: purchase.paymentDate,
    utilisateurId: purchase.createdByUserId,
    utilisateurNom: purchase.createdBy.fullName,
    observation: purchase.observation ?? "",
    statut: mapPurchaseStatus(purchase.status),
    pricingMode: purchase.pricingMode,
    lignes: purchase.lines.map((line) => {
      const unitHT = line.unitPurchasePrice.toNumber();
      const rate = line.taxRate.toNumber();
      const remise1 = line.discountRate.toNumber();
      const remise2 = line.discountRate2.toNumber();
      // For DOUBLE_DISCOUNT_HT: rebuild the net unit HT from the three
      // persisted values (gross, r1, r2) so history / detail / print show
      // exactly what was entered. Harmless for CLASSIC_TTC (not displayed).
      const prixNetHT = roundMoney(
        calculateDoubleDiscountPrice({
          grossHT: unitHT,
          discount1: remise1,
          discount2: remise2,
        }).netHT,
      );
      return {
        productId: line.productId,
        productName: line.product.name,
        quantite: line.receivedQuantity || line.orderedQuantity,
        // prixAchat kept HT for backward compatibility; prixAchatTTC is what
        // the TTC-based (classic) UI shows.
        prixAchat: unitHT,
        prixAchatTTC: roundMoney(unitHT * (1 + rate / 100)),
        // Double-remise view: gross HT is the stored unit price; r1/r2 and
        // the derived net HT.
        prixBrutHT: unitHT,
        remise1Percent: remise1,
        remise2Percent: remise2,
        prixNetHT,
        remisePercent: remise1,
        tauxTVA: rate,
        totalHT: line.totalHT.toNumber(),
        totalTVA: line.taxAmount.toNumber(),
        totalTTC: line.totalTTC.toNumber(),
      };
    }),
    createdAt: purchase.createdAt,
    updatedAt: purchase.updatedAt,
  };
}

async function nextPurchaseNumber(
  tx: Prisma.TransactionClient,
  organizationId: string,
) {
  const number = await reserveDocumentSequence(
    tx,
    organizationId,
    DocumentType.Purchase,
  );
  return `A-${String(number).padStart(6, "0")}`;
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
