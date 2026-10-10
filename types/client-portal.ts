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
  /** TTC catalogue price (the POS's own price) - never the purchase price or a margin. */
  priceTTC: number;
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

/** Browser-side cart line (display only - the server re-prices everything at submission). */
export type ClientCartLine = {
  productId: string;
  productName: string;
  reference: string;
  priceTTC: number;
  imageUrl: string | null;
  quantity: number;
};

export type ClientOrderSummaryDto = {
  id: string;
  orderNumber: string;
  status: CustomerOrderStatusValue;
  /** Estimated total frozen at submission. */
  totalTTC: number;
  itemCount: number;
  createdAt: string;
  /** CONVERTED but the linked sale is still a pending (DRAFT) invoice. */
  invoicePending: boolean;
};
