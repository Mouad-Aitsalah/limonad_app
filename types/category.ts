export type CategoryListItem = {
  id: string;
  code: string | null;
  name: string;
  productCount: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CategoriesPayload = {
  items: CategoryListItem[];
};

export type CategoryMutationInput = {
  code?: string | null;
  name: string;
  active?: boolean;
};
