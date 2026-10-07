import type { CustomerDto, DriverPosProductDto } from "@/types/operations-dto";

/**
 * A cart prepared by the AI assistant, re-validated by the server for the POS
 * (GET /api/pos/ai-draft/[id]). No price, total or discount travels here: the
 * POS computes them from `products` (its own catalogue shape) as for any line.
 */
export type AiPosDraftForPosDto = {
  id: string;
  expiresAt: string;
  /** Only lines whose product is still sellable (ACTIVE, same organisation). */
  lines: Array<{ productId: string; quantity: number }>;
  /** The POS product of every line - loaded explicitly, even beyond the POS preload. */
  products: DriverPosProductDto[];
  /** The draft's customer if still ACTIVE; null = the POS keeps its default customer. */
  customer: CustomerDto | null;
  /** Names of draft products no longer sellable (dropped, the POS says so). */
  unavailableProducts: string[];
  /** The draft named a customer that is no longer usable. */
  customerUnavailable: boolean;
};
