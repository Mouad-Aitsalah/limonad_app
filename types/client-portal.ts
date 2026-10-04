/**
 * CLIENT PLATFORM (branch `client-platform`) - the external customer-facing
 * catalog/order platform, entirely separate from the staff ERP's own types.
 */

/**
 * The client session's own claims. Deliberately NOT tied to a Customer row:
 * a visitor identifies only by email + Organization.code (see
 * lib/server/client-auth.ts's own doc comment) - the email is kept as-is in
 * the session, never looked up or verified against Customer.
 */
export type ClientSessionDto = {
  organizationId: string;
  organizationCode: string;
  email: string;
};

export type ClientOrganizationIdentityDto = {
  name: string;
  tradeName: string | null;
  logoUrl: string | null;
};

export type ClientCatalogCategoryDto = {
  id: string;
  name: string;
};

export type ClientCatalogProductDto = {
  id: string;
  name: string;
  categoryId: string;
  categoryName: string;
  /** TTC, the price the client actually pays - never the internal purchasePrice/margin. */
  priceTTC: number;
  imageUrl: string | null;
  /**
   * Deliberately a yes/no, never the real quantity: an exact stock count is
   * internal operational data, not something to expose on a public-facing
   * ordering surface.
   */
  available: boolean;
};

export type ClientCatalogDto = {
  organization: ClientOrganizationIdentityDto;
  categories: ClientCatalogCategoryDto[];
  products: ClientCatalogProductDto[];
};

/** Local-only cart line (browser storage, V1 - no server-side order yet). */
export type ClientCartLine = {
  productId: string;
  productName: string;
  priceTTC: number;
  imageUrl: string | null;
  quantity: number;
};
