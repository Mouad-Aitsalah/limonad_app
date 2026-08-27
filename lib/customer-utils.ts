import type { Customer, CustomerStatus, CustomerType } from "@/types/customer";

export const customerTypeLabels: Record<CustomerType, string> = {
  epicerie: "Epicerie",
  cafe: "Cafe",
  restaurant: "Restaurant",
  supermarche: "Supermarche",
  grossiste: "Grossiste",
  client_comptoir: "Client comptoir",
  autre: "Autre",
};

export const customerStatusLabels: Record<CustomerStatus, string> = {
  actif: "Actif",
  inactif: "Inactif",
  bloque: "Bloque",
};

export function generateNextCustomerCode(customers: Customer[]) {
  const max = customers.reduce((highest, customer) => {
    const match = customer.code.match(/^CLI-(\d+)$/);
    if (!match) return highest;
    return Math.max(highest, Number(match[1]));
  }, 0);

  return `CLI-${String(max + 1).padStart(4, "0")}`;
}

export function normalizeCustomerText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}
