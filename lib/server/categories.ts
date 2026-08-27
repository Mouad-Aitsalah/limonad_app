import "server-only";

import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { requireSessionUser } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import type { ProductOptionDto } from "@/types/product-dto";
import type {
  CategoryListItem,
  CategoryMutationInput,
  CategoriesPayload,
} from "@/types/category";

const categoryCodePrefix = "CAT-";

const categoryMutationSchema = z.object({
  code: z
    .string()
    .trim()
    .transform((value) => (value.length > 0 ? value.toUpperCase() : null))
    .nullable()
    .optional(),
  name: z.string().trim().min(1, "La designation categorie est obligatoire."),
  active: z.boolean().optional(),
});

export async function getCategories(): Promise<CategoriesPayload> {
  await requireSessionUser(["admin", "depot_manager", "cashier"]);

  const categories = await prisma.category.findMany({
    include: {
      _count: {
        select: { products: true },
      },
    },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  return {
    items: categories.map(mapCategoryToListItem),
  };
}

export async function getCategoryOptions(): Promise<ProductOptionDto[]> {
  await requireSessionUser(["admin", "depot_manager", "cashier"]);

  return prisma.category.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function createCategory(
  input: CategoryMutationInput,
): Promise<CategoryListItem> {
  await requireSessionUser(["admin", "depot_manager", "cashier"]);

  const data = parseCategoryInput(input);

  const category = await withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const code = data.code ?? (await nextCategoryCode(tx));
        await ensureUniqueCategoryCode(tx, code);
        await ensureUniqueCategoryName(tx, data.name);

        return tx.category.create({
          data: {
            code,
            name: data.name,
            active: data.active ?? true,
          },
          include: {
            _count: {
              select: { products: true },
            },
          },
        });
      },
      { isolationLevel: "Serializable" },
    ),
  );

  return mapCategoryToListItem(category);
}

export async function updateCategory(
  id: string,
  input: CategoryMutationInput,
): Promise<CategoryListItem> {
  await requireSessionUser(["admin", "depot_manager", "cashier"]);

  const data = parseCategoryInput(input);

  const currentCategory = await prisma.category.findUnique({
    where: { id },
    select: { id: true, code: true },
  });

  if (!currentCategory) {
    throw new OperationsServiceError("Categorie introuvable.", 404);
  }

  const category = await withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const code =
          data.code ??
          currentCategory.code ??
          (await nextCategoryCode(tx));

        await ensureUniqueCategoryCode(tx, code, id);
        await ensureUniqueCategoryName(tx, data.name, id);

        return tx.category.update({
          where: { id },
          data: {
            code,
            name: data.name,
            active: data.active ?? true,
          },
          include: {
            _count: {
              select: { products: true },
            },
          },
        });
      },
      { isolationLevel: "Serializable" },
    ),
  );

  return mapCategoryToListItem(category);
}

export async function setCategoryStatus(
  id: string,
  active: boolean,
): Promise<CategoryListItem> {
  await requireSessionUser(["admin", "depot_manager", "cashier"]);

  const category = await prisma.category.update({
    where: { id },
    data: { active },
    include: {
      _count: {
        select: { products: true },
      },
    },
  });

  return mapCategoryToListItem(category);
}

function parseCategoryInput(input: CategoryMutationInput) {
  const parsed = categoryMutationSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationsServiceError(
      "Categorie invalide.",
      422,
      Object.fromEntries(
        parsed.error.issues.map((issue) => [
          issue.path.join(".") || "form",
          issue.message,
        ]),
      ),
    );
  }

  return parsed.data;
}

function mapCategoryToListItem(category: {
  id: string;
  code: string | null;
  name: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  _count: { products: number };
}): CategoryListItem {
  return {
    id: category.id,
    code: category.code,
    name: category.name,
    productCount: category._count.products,
    active: category.active,
    createdAt: category.createdAt.toISOString(),
    updatedAt: category.updatedAt.toISOString(),
  };
}

async function nextCategoryCode(tx: Pick<typeof prisma, "category">) {
  const categories = await tx.category.findMany({
    where: {
      code: {
        startsWith: categoryCodePrefix,
      },
    },
    select: { code: true },
  });

  const max = categories.reduce((highest, category) => {
    const match = category.code?.match(/^CAT-(\d+)$/);
    if (!match) return highest;
    return Math.max(highest, Number(match[1]));
  }, 0);

  return `${categoryCodePrefix}${String(max + 1).padStart(3, "0")}`;
}

async function ensureUniqueCategoryCode(
  tx: Pick<typeof prisma, "category">,
  code: string,
  currentCategoryId?: string,
) {
  const existing = await tx.category.findFirst({
    where: {
      code,
      ...(currentCategoryId ? { id: { not: currentCategoryId } } : {}),
    },
    select: { id: true },
  });

  if (existing) {
    throw new OperationsServiceError("Une categorie existe deja avec cette reference.", 409, {
      code: "Une categorie existe deja avec cette reference.",
    });
  }
}

async function ensureUniqueCategoryName(
  tx: Pick<typeof prisma, "category">,
  name: string,
  currentCategoryId?: string,
) {
  const existing = await tx.category.findFirst({
    where: {
      name,
      ...(currentCategoryId ? { id: { not: currentCategoryId } } : {}),
    },
    select: { id: true },
  });

  if (existing) {
    throw new OperationsServiceError("Une categorie existe deja avec cette designation.", 409, {
      name: "Une categorie existe deja avec cette designation.",
    });
  }
}

async function withSerializableRetry<T>(operation: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let attempt = 0;

  while (attempt < maxAttempts) {
    try {
      return await operation();
    } catch (error) {
      const prismaError = error as { code?: string };
      attempt += 1;

      if (!["P2002", "P2034"].includes(prismaError.code ?? "") || attempt >= maxAttempts) {
        throw error;
      }
    }
  }

  throw new OperationsServiceError("Impossible de generer la reference categorie.", 500);
}
