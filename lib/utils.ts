import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { roundMoney } from "@/lib/money"
export { formatCurrency } from "@/lib/currency"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// F8-B: delegates to the shared decimal-based engine (lib/money.ts) instead
// of `Math.round(value * 100) / 100`, which can misround values like 1.005
// or 10.075 due to IEEE754 float imprecision. Re-exported under this same
// name so every existing caller (product-pricing.ts, pos-layout.tsx) needed
// zero changes.
export function roundCurrency(value: number) {
  return roundMoney(value)
}

export function formatSlugLabel(id: string) {
  return id
    .replace(/^[a-z]+-/, "")
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}
