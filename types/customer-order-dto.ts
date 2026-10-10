import type { CustomerOrderStatusValue } from "@/lib/client-portal-rules";
import type { CustomerDto, DriverPosProductDto } from "@/types/operations-dto";

/** Internal "Commandes en ligne" screen - one order of the list. */
export type CustomerOrderListItemDto = {
  id: string;
  orderNumber: string;
  status: CustomerOrderStatusValue;
  customer: { id: string; name: string; displayCode: string };
  contactPhone: string | null;
  itemCount: number;
  /** Estimated total frozen at submission (the invoice is recomputed by the POS). */
  totalTTC: number;
  createdAt: string;
  processedAt: string | null;
  processedByName: string | null;
  convertedSaleId: string | null;
  /** CONVERTED but the linked sale is still a pending (DRAFT) invoice: show "Facture en attente". */
  invoicePending: boolean;
};

export type CustomerOrderDetailDto = CustomerOrderListItemDto & {
  note: string | null;
  rejectionReason: string | null;
  subtotalHT: number;
  taxAmount: number;
  roundingAmount: number;
  lines: Array<{
    productId: string;
    productName: string;
    productReference: string;
    quantity: number;
    unitPriceHT: number;
    taxRate: number;
    totalTTC: number;
  }>;
};

export type CustomerOrdersPageDto = {
  items: CustomerOrderListItemDto[];
  nextCursor: string | null;
};

/**
 * An ACCEPTED order re-validated for the POS (GET /api/customer-orders/[id]/pos):
 * only {productId, quantity} lines whose product is still sellable, the POS
 * product data for each (loaded explicitly, even beyond the 500 preloaded),
 * and the customer. No price travels here: the POS computes it.
 */
export type CustomerOrderForPosDto = {
  id: string;
  orderNumber: string;
  customer: CustomerDto;
  lines: Array<{ productId: string; quantity: number }>;
  products: DriverPosProductDto[];
  unavailableProducts: string[];
};
