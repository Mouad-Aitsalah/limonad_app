/**
 * Espace Client ("Commander en ligne") - the external customer-facing
 * ordering space, entirely separate from the staff ERP's own types.
 */

import type { CustomerOrderStatusValue } from "@/lib/client-portal-rules";

/**
 * The verified client session: a real ACTIVE Customer of an ACTIVE
 * Organization (re-checked on every request - see lib/server/client-auth.ts).
 * contactPhone is the optional number typed at login: contact info only,
 * never an identity proof.
 */
export type ClientSessionDto = {
  organizationId: string;
  organizationCode: string;
  customerId: string;
  customerName: string;
  /** "3421/15" style - display only. */
  customerDisplayCode: string;
  contactPhone: string | null;
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
  reference: string;
  description: string | null;
  categoryId: string;
  categoryName: string;
  // No price of any kind: the Espace Client never shows one, so the server never sends it (prices are
  // applied server-side when the order is recorded - client-portal-core.ts#submitClientOrder).
  /** Always present: a product without a valid photo is never in the catalogue. */
  imageUrl: string;
  /**
   * Deliberately a yes/no, never the real quantity: an exact stock count is
   * internal operational data. Negative stock being allowed, "false" means
   * "sur commande", not "impossible".
   */
  available: boolean;
};

export type ClientCatalogPageDto = {
  products: ClientCatalogProductDto[];
  nextCursor: string | null;
};

export type ClientCatalogDto = {
  organization: ClientOrganizationIdentityDto;
  categories: ClientCatalogCategoryDto[];
  firstPage: ClientCatalogPageDto;
};

/** Browser-side cart line: what to show and how many - never a price (the server prices the order). */
export type ClientCartLine = {
  productId: string;
  productName: string;
  reference: string;
  imageUrl: string | null;
  quantity: number;
};

/** An order as the customer sees it: no amount (the order's prices stay on the staff side). */
export type ClientOrderSummaryDto = {
  id: string;
  orderNumber: string;
  status: CustomerOrderStatusValue;
  itemCount: number;
  createdAt: string;
  /** CONVERTED but the linked sale is still a pending (DRAFT) invoice. */
  invoicePending: boolean;
};
