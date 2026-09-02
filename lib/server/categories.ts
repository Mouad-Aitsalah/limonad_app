import "server-only";

import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { OperationsServiceError } from "@/lib/server/depots";
import { DocumentType, reserveDocumentSequence } from "@/lib/server/document-sequence";
import { requireOrganizationUser } from "@/lib/server/organization-context";
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
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);

  const categories = await prisma.category.findMany({
    where: { organizationId: currentUser.organizationId },
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
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);

  return prisma.category.findMany({
    where: {
      active: true,
      organizationId: currentUser.organizationId,
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function createCategory(
  input: CategoryMutationInput,
): Promise<CategoryListItem> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);

  const data = parseCategoryInput(input);

  const category = await withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const code = data.code ?? (await nextCategoryCode(tx, currentUser.organizationId));
        await ensureUniqueCategoryCode(tx, currentUser.organizationId, code);
        await ensureUniqueCategoryName(tx, currentUser.organizationId, data.name);

        return tx.category.create({
          data: {
            organizationId: currentUser.organizationId,
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
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);

  const data = parseCategoryInput(input);

  const currentCategory = await prisma.category.findFirst({
    where: { id, organizationId: currentUser.organizationId },
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
          (await nextCategoryCode(tx, currentUser.organizationId));

        await ensureUniqueCategoryCode(tx, currentUser.organizationId, code, id);
        await ensureUniqueCategoryName(tx, currentUser.organizationId, data.name, id);

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
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const existing = await prisma.category.findFirst({
    where: { id, organizationId: currentUser.organizationId },
    select: { id: true },
  });
  if (!existing) {
    throw new OperationsServiceError("Categorie introuvable.", 404);
  }

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

async function nextCategoryCode(
  tx: Pick<typeof prisma, "category" | "$queryRaw">,
  organizationId: string,
) {
  const number = await reserveDocumentSequence(
    tx,
    organizationId,
    DocumentType.CategoryCode,
  );
  return `${categoryCodePrefix}${String(number).padStart(3, "0")}`;
}

async function ensureUniqueCategoryCode(
  tx: Pick<typeof prisma, "category">,
  organizationId: string,
  code: string,
  currentCategoryId?: string,
) {
  const existing = await tx.category.findFirst({
    where: {
      organizationId,
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
  organizationId: string,
  name: string,
  currentCategoryId?: string,
) {
  const existing = await tx.category.findFirst({
    where: {
      organizationId,
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

  throw new OperationsServiceError("Impossible de generer la reference categorie.", 500);
}
