import type { FunctionDeclaration } from "@google/genai";
import { z } from "zod";

import type {
  PurchaseRecommendation,
  PurchaseRecommendationOptions,
  PurchaseRecommendationResult,
  Reliability,
} from "@/lib/forecasting/purchase-recommendation";

/**
 * AI Assistant tool `get_purchase_recommendations` (forecasting step 4).
 *
 * The Assistant NEVER computes a quantity to buy: this tool only calls the
 * existing engine (getPurchaseRecommendations, lib/server/purchase-
 * recommendation.ts) and hands its numbers back, untouched, for the model to
 * present. The organisation is never an argument: the engine takes it from the
 * session. No server-only import here (the engine is injected), so the tool
 * can be tested without a database.
 */

export const PURCHASE_TOOL_NAME = "get_purchase_recommendations";

const MAX_PRODUCTS_DEFAULT = 20;
const MAX_PRODUCTS_LIMIT = 50;
const MAX_MATCHES = 10;

export const purchaseRecommendationsArgumentsSchema = z
  .object({
    maxProducts: z.coerce.number().int().min(1).max(MAX_PRODUCTS_LIMIT).optional(),
    includeNoPurchase: z.boolean().optional(),
    includeNeverSold: z.boolean().optional(),
    productQuery: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export const purchaseRecommendationsDeclaration: FunctionDeclaration = {
  name: PURCHASE_TOOL_NAME,
  description:
    "Retourne les recommandations d'achat (réapprovisionnement) de l'organisation connectée pour les 7 prochains jours, calculées par le moteur de prévision : pour chaque produit le stock actuel, les ventes prévues sur 1, 3 et 7 jours, le stock de sécurité, le stock cible, la quantité recommandée à acheter (recommendedPurchase) et la fiabilité. Un produit à stock négatif n'a jamais d'achat recommandé : il est à régulariser. À utiliser pour les questions sur ce qu'il faut acheter, commander ou réapprovisionner, la quantité à acheter, les produits qui vont bientôt manquer ou dont le stock est insuffisant. Appelle-la UNE SEULE fois par question. Ne l'utilise pas pour une question sans rapport avec les achats ou le stock à venir.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      maxProducts: {
        type: "integer",
        description: "Nombre maximum de produits par liste retournée (1 à 50, 20 par défaut).",
      },
      includeNoPurchase: {
        type: "boolean",
        description:
          "true pour aussi lister les produits qui n'ont pas besoin d'achat (stock suffisant). À n'utiliser que si l'utilisateur le demande. Faux par défaut.",
      },
      includeNeverSold: {
        type: "boolean",
        description: "true pour inclure les produits jamais vendus (achat toujours 0). Faux par défaut.",
      },
      productQuery: {
        type: "string",
        description:
          "Nom (ou partie du nom) d'UN produit précis quand l'utilisateur demande combien en acheter, ex. « Coca 2L ». Retourne alors uniquement les produits dont le nom correspond.",
      },
    },
    additionalProperties: false,
  },
};

/**
 * Appended to the Assistant instruction (route.ts). Tells the model when to
 * call the tool and how to present its result - never how to compute it.
 */
export const PURCHASE_TOOL_INSTRUCTIONS = `Pour les questions sur ce qu'il faut acheter, commander ou réapprovisionner (par exemple « qu'est-ce que je dois acheter cette semaine », « quels produits dois-je commander », « combien dois-je acheter », « quels produits vont bientôt manquer », « quels produits ont un stock insuffisant », « donne-moi les recommandations d'achat », « combien de Coca 2L dois-je acheter »), appelle get_purchase_recommendations, UNE SEULE fois par question, puis réponds à partir de son résultat. Pour UN produit nommé, passe son nom dans productQuery. N'appelle jamais cette fonction pour une question sans rapport avec les achats ou le stock à venir (ventes, clients, factures, stock actuel d'un produit, etc.). Tu ne calcules JAMAIS toi-même une quantité à acheter, un stock cible ou un stock de sécurité : tu reprends exactement les valeurs du résultat (recommendedPurchase, currentStock, forecast7Days, safetyStock, targetStock) sans jamais en inventer. Présente d'abord les produits de toBuy (achat supérieur à 0), avec pour chacun : produit, quantité à acheter, stock actuel, prévision sur 7 jours, stock de sécurité et fiabilité (reliabilityLabel). Indique toujours la fiabilité et ne présente jamais une prévision peu fiable comme une certitude : si la fiabilité est « très limitée » ou « limitée », dis que l'historique est court ; si c'est « aucune donnée », dis qu'aucune prévision n'est possible. Si toBuyTruncated est à true, précise que seuls les premiers produits sont affichés. Ne liste les produits sans achat (noPurchaseNeeded) que si l'utilisateur le demande ou veut une analyse complète. Stock négatif : un produit de negativeStock ne reçoit JAMAIS d'achat automatique, même si la prévision est nulle ; signale-le avec « Stock négatif à régulariser », indique sa valeur négative, dis qu'aucun achat automatique n'est recommandé et qu'il faut d'abord vérifier et régulariser le stock ; ne transforme jamais ce déficit en quantité à acheter et n'écris jamais « achetez » pour ces produits. Quand une question vise un produit précis (found), donne stock actuel, prévision 7 jours, stock de sécurité, stock cible, achat recommandé et fiabilité ; si multipleMatches est à true, énumère les produits trouvés et demande de préciser lequel, sans choisir à la place de l'utilisateur ; si found est à false, dis qu'aucune recommandation n'existe pour ce nom (produit jamais vendu ou inconnu). Un produit inactif ou arrêté n'a pas d'achat automatique : dis-le.`;

const RELIABILITY_LABELS: Record<Reliability, string> = {
  sufficient: "suffisante",
  limited: "limitée",
  very_limited: "très limitée",
  none: "aucune donnée",
};

export function formatPurchaseItem(item: PurchaseRecommendation) {
  return {
    productId: item.productId,
    productName: item.productName,
    productStatus: item.productStatus,
    currentStock: item.currentStock,
    stockKnown: item.stockKnown,
    forecast1Day: item.forecast1Day,
    forecast3Days: item.forecast3Days,
    forecast7Days: item.forecast7Days,
    safetyStock: item.safetyStock,
    targetStock: item.targetStock,
    recommendedPurchase: item.recommendedPurchaseQuantity,
    reliability: item.reliability,
    reliabilityLabel: RELIABILITY_LABELS[item.reliability],
    stockAlert: item.stockRegularizationRequired ? "Stock négatif à régulariser" : null,
    reason: item.reason,
  };
}

/** Lowercase, accent-free, for a tolerant name match. */
function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

export type PurchaseToolDeps = {
  getPurchaseRecommendations: (options?: PurchaseRecommendationOptions) => Promise<PurchaseRecommendationResult>;
};

/**
 * One runner per chat request: the engine (slow, ~10 s) is run at most ONCE,
 * whatever the number of tool calls or arguments (it is always asked for the
 * never-sold products too - they cost nothing to compute - and the lists are
 * cut afterwards). Every figure is the engine's own; only the selection of
 * what is returned changes.
 */
export function createPurchaseToolRunner(deps: PurchaseToolDeps) {
  let engineRun: Promise<PurchaseRecommendationResult> | undefined;
  const run = () => {
    engineRun ??= deps.getPurchaseRecommendations({ includeNeverSold: true });
    return engineRun;
  };

  return async function runPurchaseRecommendationsTool(rawArguments: unknown): Promise<Record<string, unknown>> {
    const parsed = purchaseRecommendationsArgumentsSchema.safeParse(rawArguments ?? {});
    if (!parsed.success) return { error: "Les paramètres des recommandations d'achat sont invalides." };

    const { maxProducts = MAX_PRODUCTS_DEFAULT, includeNoPurchase = false, includeNeverSold = false, productQuery } = parsed.data;
    const { asOf, recommendations: all } = await run();
    // never-sold products are only listed when asked for (they always get 0)
    const recommendations = includeNeverSold ? all : all.filter((item) => item.reliability !== "none");

    if (productQuery) {
      const needle = normalize(productQuery);
      const matches = all.filter((item) => normalize(item.productName).includes(needle));
      return {
        query: productQuery,
        asOf,
        horizonDays: 7,
        found: matches.length > 0,
        multipleMatches: matches.length > 1,
        products: matches.slice(0, MAX_MATCHES).map(formatPurchaseItem),
      };
    }

    const negativeStock = recommendations.filter((item) => item.stockRegularizationRequired);
    const toBuy = recommendations.filter((item) => item.recommendedPurchaseQuantity > 0);
    const noPurchase = recommendations.filter(
      (item) => item.recommendedPurchaseQuantity === 0 && !item.stockRegularizationRequired,
    );

    return {
      asOf,
      horizonDays: 7,
      productsAnalyzed: recommendations.length,
      toBuyCount: toBuy.length,
      toBuyTruncated: toBuy.length > maxProducts,
      toBuy: toBuy.slice(0, maxProducts).map(formatPurchaseItem),
      negativeStockCount: negativeStock.length,
      negativeStock: negativeStock.slice(0, maxProducts).map(formatPurchaseItem),
      noPurchaseNeededCount: noPurchase.length,
      ...(includeNoPurchase ? { noPurchaseNeeded: noPurchase.slice(0, maxProducts).map(formatPurchaseItem) } : {}),
    };
  };
}
