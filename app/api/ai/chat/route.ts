import {
  FunctionCallingConfigMode,
  GoogleGenAI,
  type FunctionCall,
  type FunctionDeclaration,
} from "@google/genai";
import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { AuthServiceError } from "@/lib/server/auth";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { requireOrganizationUser } from "@/lib/server/organization-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PRODUCTS = 20;
const MAX_FUNCTION_CALLS = 2;

const bodySchema = z.object({
  message: z.string().trim().min(1).max(600),
});

const noArgumentsSchema = z.object({}).strict();

const listProductsArgumentsSchema = z
  .object({
    search: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

const functionDeclarations: FunctionDeclaration[] = [
  {
    name: "get_product_count",
    description:
      "Retourne le nombre total réel de produits de l'organisation connectée. À utiliser pour les questions sur le nombre de produits.",
    parametersJsonSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "list_products",
    description:
      "Liste au plus 20 produits de l'organisation connectée. Le paramètre search est facultatif et recherche dans le nom ou la référence.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        search: {
          type: "string",
          description: "Texte à rechercher dans le nom ou la référence du produit.",
        },
      },
      additionalProperties: false,
    },
  },
];

const systemInstruction = `Tu es l'assistant IA de COMDIS. Réponds exclusivement en français, de façon claire et concise.

Tu peux consulter uniquement les données renvoyées par les fonctions disponibles. Ces résultats sont déjà limitées à l'organisation connectée : ne demande, n'invente ni n'évoque jamais d'identifiant d'organisation et ne prétends jamais avoir accès à toute la base de données.

Pour les questions sur le nombre de produits, utilise get_product_count. Pour lister ou rechercher des produits, utilise list_products. Ne cite jamais un produit, un prix ou une autre donnée qui ne figure pas dans les résultats des fonctions. Si une question nécessite des produits hors de la liste reçue ou d'autres données métier, indique clairement que cette capacité sera ajoutée dans une prochaine étape.

Lorsqu'une liste indique hasMore à true, précise que seuls les 20 premiers produits correspondants sont affichés. Pour chaque produit listé, affiche le nom, la référence si elle est disponible et le prix de vente si disponible.`;

function formatSalePrice(salePrice: { toNumber: () => number } | null | undefined) {
  return salePrice == null ? null : `${salePrice.toNumber().toFixed(2)} DH`;
}

export async function POST(request: Request) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;

  try {
    const user = await requireOrganizationUser(["admin"]);

    const parsedBody = bodySchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return NextResponse.json({ message: "Le message est invalide." }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ message: "La clé Gemini n'est pas configurée." }, { status: 500 });
    }

    const executeFunctionCall = async (
      functionCall: FunctionCall,
    ): Promise<Record<string, unknown>> => {
      if (functionCall.name === "get_product_count") {
        if (!noArgumentsSchema.safeParse(functionCall.args ?? {}).success) {
          return { error: "Cette fonction n'accepte aucun paramètre." };
        }

        const productCount = await prisma.product.count({
          where: { organizationId: user.organizationId },
        });

        return { productCount };
      }

      if (functionCall.name === "list_products") {
        const parsedArguments = listProductsArgumentsSchema.safeParse(functionCall.args ?? {});
        if (!parsedArguments.success) {
          return { error: "Les paramètres de recherche sont invalides." };
        }

        const search = parsedArguments.data.search;
        const productWhere = search
          ? {
              organizationId: user.organizationId,
              OR: [
                { name: { contains: search, mode: "insensitive" as const } },
                { reference: { contains: search, mode: "insensitive" as const } },
              ],
            }
          : { organizationId: user.organizationId };

        const [totalMatchingProducts, products] = await Promise.all([
          prisma.product.count({ where: productWhere }),
          prisma.product.findMany({
            where: productWhere,
            select: { name: true, reference: true, salePrice: true },
            orderBy: { name: "asc" },
            take: MAX_PRODUCTS,
          }),
        ]);

        return {
          totalMatchingProducts,
          returnedProducts: products.length,
          hasMore: totalMatchingProducts > products.length,
          products: products.map((product) => ({
            name: product.name,
            reference: product.reference.trim() || null,
            salePrice: formatSalePrice(product.salePrice),
          })),
        };
      }

      return { error: "La fonction demandée n'est pas disponible." };
    };

    const executeFunctionCallSafely = async (functionCall: FunctionCall) => {
      try {
        return await executeFunctionCall(functionCall);
      } catch (error) {
        console.error("Erreur de lecture des produits pour l'assistant IA :", error);
        return { error: "La lecture des produits est temporairement indisponible." };
      }
    };

    const ai = new GoogleGenAI({ apiKey });
    const chat = ai.chats.create({
      model: "gemini-3.5-flash-lite",
      config: {
        systemInstruction,
        tools: [{ functionDeclarations }],
        toolConfig: {
          functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO },
        },
      },
    });

    let result = await chat.sendMessage({ message: parsedBody.data.message });
    let executedFunctionCalls = 0;

    while (result.functionCalls?.length && executedFunctionCalls < MAX_FUNCTION_CALLS) {
      const remainingFunctionCalls = MAX_FUNCTION_CALLS - executedFunctionCalls;
      const functionCalls = result.functionCalls.slice(0, remainingFunctionCalls);
      const functionResponses = await Promise.all(
        functionCalls.map(async (functionCall) => ({
          functionResponse: {
            id: functionCall.id,
            name: functionCall.name ?? "unknown_function",
            response: await executeFunctionCallSafely(functionCall),
          },
        })),
      );

      executedFunctionCalls += functionCalls.length;
      result = await chat.sendMessage({ message: functionResponses });
    }

    if (result.functionCalls?.length) {
      result = await chat.sendMessage({
        message:
          "La limite de consultations est atteinte. Réponds maintenant à la question en français uniquement à partir des résultats déjà reçus, sans appeler d'autre fonction.",
        config: {
          systemInstruction,
          tools: [{ functionDeclarations }],
          toolConfig: {
            functionCallingConfig: { mode: FunctionCallingConfigMode.NONE },
          },
        },
      });
    }

    return NextResponse.json({ response: result.text ?? "Je n'ai pas pu générer de réponse." });
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    console.error("Erreur API IA :", error);
    return NextResponse.json({ message: "Impossible de contacter l'assistant IA." }, { status: 502 });
  }
}
