import type { FunctionDeclaration } from "@google/genai";
import { z } from "zod";

import {
  AI_POS_DRAFT_LINK_LABEL,
  AI_POS_DRAFT_MAX_QUANTITY,
  aiPosDraftHref,
  applyAiPosDraftOperations,
  resolveCustomerCandidates,
  resolveProductCandidates,
  stockWarning,
  type AiPosDraftLine,
  type AiPosDraftLineOperation,
  type CustomerCandidate,
  type ProductCandidate,
  type Resolution,
} from "@/lib/assistant-pos-draft-rules";

/**
 * AI Assistant tool `prepare_pos_sale`: turns "dir lia factura fiha 2 coca
 * 2 hawai 2 poms l client autre" into a PREPARED POS cart (AiPosDraft), and
 * edits it ("zid 2 coca", "na9es wa7ed coca", "7yed poms", "bdel client
 * Karim").
 *
 * It NEVER creates a Sale, Payment, StockMovement or AccountingEntry: the only
 * write is the AiPosDraft row ({ productId, quantity } lines + customer). The
 * sale is created later by the POS's own validation (createCounterSale).
 *
 * The model only sends TEXT (productQuery, quantity, customerQuery, action):
 * every product / customer is resolved here, against the organisation of the
 * session (the store is built for it), and the draft state is always read
 * from the database - the model never supplies an id, a price, a stock or the
 * cart contents. No server-only import (the store is injected), so the whole
 * flow is tested without a database (lib/server/assistant-pos-draft-tool.test.ts).
 */

export const POS_DRAFT_TOOL_NAME = "prepare_pos_sale";

const MAX_ITEMS = 20;

export const preparePosSaleArgumentsSchema = z
  .object({
    mode: z.enum(["new", "edit"]),
    customerQuery: z.string().trim().min(1).max(100).optional(),
    items: z
      .array(
        z
          .object({
            action: z.enum(["add", "decrease", "remove", "set"]),
            productQuery: z.string().trim().min(1).max(100),
            quantity: z.coerce.number().int().positive().max(AI_POS_DRAFT_MAX_QUANTITY).optional(),
          })
          .strict(),
      )
      .max(MAX_ITEMS)
      .optional(),
  })
  .strict();

export type PreparePosSaleArguments = z.infer<typeof preparePosSaleArgumentsSchema>;

export const preparePosSaleDeclaration: FunctionDeclaration = {
  name: POS_DRAFT_TOOL_NAME,
  description:
    "Prépare un PANIER POS (brouillon) à partir de la demande de l'utilisateur, ou modifie le panier déjà préparé dans cette conversation. Ne crée JAMAIS de vente, de facture, de paiement, de mouvement de stock ni d'écriture comptable : l'utilisateur vérifiera puis validera lui-même la vente dans le POS. Les produits et le client sont recherchés par texte côté serveur (ne fournis jamais d'identifiant, de prix, de stock ni le contenu complet du panier). mode « new » pour une nouvelle vente (remplace le panier préparé en cours), mode « edit » pour modifier le panier en cours (ajouter, diminuer, retirer un produit, changer le client).",
  parametersJsonSchema: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["new", "edit"],
        description:
          "new = nouvelle vente / nouveau panier (« dir lia factura fiha... », « prépare une vente de... »). edit = modification du panier déjà préparé (« zid 2 coca », « na9es wa7ed coca », « 7yed poms », « bdel client Karim »).",
      },
      customerQuery: {
        type: "string",
        description:
          "Nom, code, numéro ou téléphone du client tel que l'utilisateur l'a dit (« autre », « Karim », « 44115 »). Omis si aucun client n'est mentionné (le POS garde alors son client par défaut, ou le client déjà choisi en mode edit).",
      },
      items: {
        type: "array",
        description: "Produits concernés, un élément par produit cité.",
        items: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["add", "decrease", "remove", "set"],
              description:
                "add = ajouter cette quantité (toujours add en mode new) ; decrease = diminuer de cette quantité (1 si non précisée) ; remove = retirer complètement le produit ; set = fixer la quantité exacte.",
            },
            productQuery: {
              type: "string",
              description: "Nom, référence ou code-barres du produit tel que l'utilisateur l'a dit (« coca », « hawai », « poms »).",
            },
            quantity: {
              type: "integer",
              description: "Quantité (entier positif). Obligatoire pour add et set.",
            },
          },
          required: ["action", "productQuery"],
        },
      },
    },
    required: ["mode"],
  },
};

export const POS_DRAFT_TOOL_INSTRUCTIONS = `PRÉPARATION D'UN PANIER POS. Pour préparer, créer, faire ou générer une facture, une vente ou un panier (« dir lia factura fiha 2 coca 2 hawai 2 poms l client autre », « prépare une vente de 3 Coca pour Karim »), utilise ${POS_DRAFT_TOOL_NAME} avec mode new, un élément add par produit cité (productQuery tel que dit par l'utilisateur, quantity) et customerQuery si un client est cité. Pour modifier le panier déjà préparé dans la conversation (ajouter, diminuer, retirer un produit, changer de client), utilise ${POS_DRAFT_TOOL_NAME} avec mode edit et UNIQUEMENT les changements demandés : ne renvoie jamais le panier complet, le serveur relit lui-même le panier en cours. Tu ne peux PAS créer une vente, une facture, un paiement ou un mouvement de stock : la vente est créée uniquement lorsque l'utilisateur la valide lui-même dans le POS. Ne parle jamais de prix, de total ou de stock que tu aurais calculé toi-même. Lorsque ${POS_DRAFT_TOOL_NAME} renvoie needsClarification à true, n'invente rien et ne choisis jamais à la place de l'utilisateur : pour chaque problème, cite la recherche, puis la liste des produits ou clients proposés (nom et référence ou code) et demande lequel il veut, ou indique clairement que le produit ou le client est introuvable ; quand l'utilisateur précise, rappelle ${POS_DRAFT_TOOL_NAME} avec la demande complète (en mode new si c'était une nouvelle vente) en remplaçant la recherche ambiguë par le nom ou la référence choisis. Ne crée jamais de client. Lorsque ${POS_DRAFT_TOOL_NAME} renvoie prepared à false avec une erreur, explique-la simplement. Lorsqu'il renvoie prepared à true, réponds en une phrase courte : le récapitulatif et le bouton d'ouverture du panier sont ajoutés automatiquement.`;

// ---------------------------------------------------------------------------
// Store (injected - Prisma in production, in-memory in tests)
// ---------------------------------------------------------------------------

export type StoredAiPosDraft = {
  id: string;
  status: "OPEN" | "APPLIED" | "EXPIRED";
  lines: AiPosDraftLine[];
  customerId: string | null;
  expiresAt: Date;
};

export class AiPosDraftConflictError extends Error {
  constructor() {
    super("Le panier préparé n'est plus modifiable.");
    this.name = "AiPosDraftConflictError";
  }
}

export type AiPosDraftStore = {
  /** The conversation's OPEN draft, else its most recent one, else null. An expired OPEN draft comes back EXPIRED. */
  loadCurrentDraft(): Promise<StoredAiPosDraft | null>;
  /** ACTIVE products of the organisation that may match the text query. */
  findProductCandidates(query: string): Promise<ProductCandidate[]>;
  /** ACTIVE products of the organisation among these ids (others are absent). */
  getProductsByIds(ids: string[]): Promise<ProductCandidate[]>;
  /** ACTIVE customers of the organisation for the query; exactNumberMatch = the POS "N° client" rule matched. */
  findCustomerCandidates(
    query: string,
  ): Promise<{ exactNumberMatch: CustomerCandidate | null; candidates: CustomerCandidate[] }>;
  /** An ACTIVE customer of the organisation, or null. */
  getCustomer(id: string): Promise<CustomerCandidate | null>;
  /** Available quantity per product at the user's depot (0 when no stock row), null when the user has no depot. */
  getAvailableStock(productIds: string[]): Promise<Map<string, number> | null>;
  /**
   * Writes the conversation's single OPEN draft (updated if one exists,
   * created otherwise) with a fresh expiry. With expectedDraftId, throws
   * AiPosDraftConflictError unless that exact draft is still the OPEN one.
   */
  saveDraft(input: {
    expectedDraftId: string | null;
    lines: AiPosDraftLine[];
    customerId: string | null;
  }): Promise<{ id: string; expiresAt: Date }>;
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

type ProductIssue = {
  productQuery: string;
  problem: "ambiguous" | "not_found" | "not_in_cart";
  candidates?: Array<{ name: string; reference: string }>;
};

type CustomerIssue = {
  customerQuery: string;
  problem: "ambiguous" | "not_found";
  candidates?: Array<{ name: string; code: string }>;
};

export type PreparedPosDraft = {
  prepared: true;
  mode: "new" | "edit";
  draftId: string;
  href: string;
  customer: { name: string; code: string } | null;
  lines: Array<{ productName: string; reference: string; quantity: number }>;
  warnings: string[];
  note: string;
  /** The exact message shown to the user (recap + "Ouvrir le panier" link). */
  summaryMarkdown: string;
};

function fail(error: string, extra: Record<string, unknown> = {}) {
  return { prepared: false, error, ...extra };
}

async function resolveCustomer(
  store: AiPosDraftStore,
  query: string,
): Promise<Resolution<CustomerCandidate>> {
  const { exactNumberMatch, candidates } = await store.findCustomerCandidates(query);
  if (exactNumberMatch) return { kind: "unique", item: exactNumberMatch };
  return resolveCustomerCandidates(query, candidates);
}

function escapeMarkdown(value: string) {
  return value.replace(/([\\`*_[\]])/g, "\\$1");
}

export function buildAiPosDraftSummary(input: {
  mode: "new" | "edit";
  draftId: string;
  customer: { name: string; code: string } | null;
  lines: Array<{ productName: string; quantity: number }>;
  warnings: string[];
}): string {
  const parts: string[] = [input.mode === "new" ? "✅ **Vente préparée**" : "✅ **Panier mis à jour**"];
  parts.push(
    `**Client :** ${input.customer ? escapeMarkdown(input.customer.name) : "client par défaut du POS"}`,
  );
  if (input.lines.length === 0) {
    parts.push("Le panier préparé est vide.");
    return parts.join("\n\n");
  }
  parts.push(
    ["**Produits :**", ...input.lines.map((line) => `- ${escapeMarkdown(line.productName)} × ${line.quantity}`)].join("\n"),
  );
  if (input.warnings.length > 0) parts.push(input.warnings.join("\n\n"));
  parts.push(
    "Rien n'est encore enregistré : les prix, la TVA et le total sont calculés par le POS. Vérifie le panier puis valide la vente dans le POS.",
  );
  parts.push(`[${AI_POS_DRAFT_LINK_LABEL}](${aiPosDraftHref(input.draftId)})`);
  return parts.join("\n\n");
}

export function createPosDraftToolRunner(store: AiPosDraftStore) {
  return async function runPreparePosSale(rawArgs: unknown): Promise<Record<string, unknown>> {
    const parsed = preparePosSaleArgumentsSchema.safeParse(rawArgs ?? {});
    if (!parsed.success) return fail("Les paramètres du panier sont invalides.");
    const { mode, customerQuery } = parsed.data;
    const items = parsed.data.items ?? [];

    if (mode === "new" && items.length === 0) {
      return fail("Aucun produit n'a été indiqué pour cette vente.");
    }
    if (mode === "edit" && items.length === 0 && !customerQuery) {
      return fail("Aucune modification n'a été indiquée.");
    }
    for (const item of items) {
      const needsQuantity = mode === "new" || item.action === "add" || item.action === "set";
      if (needsQuantity && item.quantity === undefined) {
        return fail(`La quantité de « ${item.productQuery} » n'a pas été indiquée.`, {
          missingQuantity: item.productQuery,
        });
      }
    }

    // The draft state always comes from the database, never from the model.
    const current = await store.loadCurrentDraft();
    let base: StoredAiPosDraft | null = null;
    if (mode === "edit") {
      if (current?.status === "APPLIED") {
        return fail(
          "Le panier préparé a déjà été ouvert dans le POS : modifie-le directement dans le POS, ou demande une nouvelle vente.",
          { alreadyApplied: true },
        );
      }
      base = current?.status === "OPEN" ? current : null;
      const needsExisting =
        Boolean(customerQuery && items.length === 0) ||
        items.some((item) => item.action === "decrease" || item.action === "remove");
      if (!base && needsExisting) {
        return fail(
          current?.status === "EXPIRED"
            ? "Le panier préparé a expiré. Demande une nouvelle vente."
            : "Aucun panier préparé n'est en cours dans cette conversation.",
          { noOpenDraft: true },
        );
      }
    }

    let customerIssue: CustomerIssue | null = null;
    let resolvedCustomer: CustomerCandidate | null = null;
    if (customerQuery) {
      const resolution = await resolveCustomer(store, customerQuery);
      if (resolution.kind === "unique") resolvedCustomer = resolution.item;
      else if (resolution.kind === "ambiguous") {
        customerIssue = {
          customerQuery,
          problem: "ambiguous",
          candidates: resolution.candidates.map((item) => ({ name: item.name, code: item.displayCode })),
        };
      } else customerIssue = { customerQuery, problem: "not_found" };
    }

    // In edit mode a product already in the cart wins ("zid 2 coca" when the
    // cart holds exactly one Coca), before searching the whole catalogue.
    const draftProducts = base && base.lines.length > 0
      ? await store.getProductsByIds(base.lines.map((line) => line.productId))
      : [];
    const productIssues: ProductIssue[] = [];
    const operations: AiPosDraftLineOperation[] = [];
    for (const item of items) {
      const action = mode === "new" ? "add" : item.action;
      const inCart = draftProducts.length > 0 ? resolveProductCandidates(item.productQuery, draftProducts) : null;
      let resolution: Resolution<ProductCandidate>;
      if (inCart && inCart.kind !== "none") {
        resolution = inCart;
      } else if (action === "decrease" || action === "remove") {
        productIssues.push({ productQuery: item.productQuery, problem: "not_in_cart" });
        continue;
      } else {
        resolution = resolveProductCandidates(
          item.productQuery,
          await store.findProductCandidates(item.productQuery),
        );
      }

      if (resolution.kind === "unique") {
        operations.push({ action, productId: resolution.item.id, quantity: item.quantity });
      } else if (resolution.kind === "ambiguous") {
        productIssues.push({
          productQuery: item.productQuery,
          problem: "ambiguous",
          candidates: resolution.candidates.map((product) => ({ name: product.name, reference: product.reference })),
        });
      } else {
        productIssues.push({
          productQuery: item.productQuery,
          problem: action === "decrease" || action === "remove" ? "not_in_cart" : "not_found",
        });
      }
    }

    if (customerIssue || productIssues.length > 0) {
      // Nothing is saved: the user must clarify first.
      return {
        prepared: false,
        needsClarification: true,
        customerIssue,
        productIssues,
        note: "Aucun panier n'a été préparé ni modifié. Demande à l'utilisateur de préciser.",
      };
    }

    const applied = applyAiPosDraftOperations(base?.lines ?? [], operations);
    if (!applied.ok) {
      return fail(
        applied.error === "TOO_MANY_LINES"
          ? "Le panier préparé contient trop de produits."
          : applied.error === "INVALID_QUANTITY"
            ? "Une quantité indiquée est invalide."
            : "Ce produit n'est pas dans le panier préparé.",
      );
    }
    if (mode === "new" && applied.lines.length === 0) {
      return fail("Aucun produit n'a été indiqué pour cette vente.");
    }

    const customerId = resolvedCustomer?.id ?? (mode === "edit" ? base?.customerId ?? null : null);

    let saved: { id: string; expiresAt: Date };
    try {
      saved = await store.saveDraft({
        expectedDraftId: mode === "edit" ? base?.id ?? null : null,
        lines: applied.lines,
        customerId,
      });
    } catch (error) {
      if (error instanceof AiPosDraftConflictError) {
        return fail(
          "Le panier préparé vient d'être ouvert dans le POS : modifie-le directement dans le POS, ou demande une nouvelle vente.",
          { alreadyApplied: true },
        );
      }
      throw error;
    }

    const productIds = applied.lines.map((line) => line.productId);
    const [products, stock, customer] = await Promise.all([
      store.getProductsByIds(productIds),
      store.getAvailableStock(productIds),
      resolvedCustomer ? Promise.resolve(resolvedCustomer) : customerId ? store.getCustomer(customerId) : null,
    ]);
    const productById = new Map(products.map((product) => [product.id, product]));
    const lines = applied.lines.map((line) => {
      const product = productById.get(line.productId);
      return {
        productName: product?.name ?? "Produit indisponible",
        reference: product?.reference ?? "",
        quantity: line.quantity,
      };
    });
    const warnings = applied.lines
      .map((line, index) =>
        stockWarning(lines[index].productName, line.quantity, stock ? stock.get(line.productId) ?? 0 : null),
      )
      .filter((warning): warning is string => warning !== null);
    const customerView = customer ? { name: customer.name, code: customer.displayCode } : null;

    const result: PreparedPosDraft = {
      prepared: true,
      mode,
      draftId: saved.id,
      href: aiPosDraftHref(saved.id),
      customer: customerView,
      lines,
      warnings,
      note: "Panier préparé uniquement : aucune vente, aucun paiement et aucun mouvement de stock n'ont été créés.",
      summaryMarkdown: buildAiPosDraftSummary({ mode, draftId: saved.id, customer: customerView, lines, warnings }),
    };
    return result;
  };
}
