import { cn } from "@/lib/utils";
import type { PurchasePricingMode } from "@/types/purchase";

export function purchasePricingModeLabel(mode: PurchasePricingMode): string {
  return mode === "DOUBLE_DISCOUNT_HT" ? "Double remise HT" : "Classique TTC";
}

type Props = {
  mode: PurchasePricingMode;
  className?: string;
};

/**
 * Discreet pill flagging a purchase's price-entry mode. Used in the
 * historique table (double-remise only, to keep classic rows clean), the
 * detail dialog and the A5 print header meta.
 */
export function PurchasePricingModeBadge({ mode, className }: Props) {
  const isDouble = mode === "DOUBLE_DISCOUNT_HT";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium",
        isDouble
          ? "bg-amber-100 text-amber-800"
          : "bg-muted text-muted-foreground",
        className,
      )}
    >
      {purchasePricingModeLabel(mode)}
    </span>
  );
}
