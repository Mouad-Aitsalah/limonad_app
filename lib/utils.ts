import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
export { formatCurrency } from "@/lib/currency"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function roundCurrency(value: number) {
  return Math.round(value * 100) / 100
}

export function formatSlugLabel(id: string) {
  return id
    .replace(/^[a-z]+-/, "")
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}
