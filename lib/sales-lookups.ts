import { customers } from "@/lib/mock-data/customers";
import { paymentMethods } from "@/lib/mock-data/payment-methods";
import { products } from "@/lib/mock-data/products";
import { trucks } from "@/lib/mock-data/trucks";
import { users } from "@/lib/mock-data/users";

export function resolveClientName(clientId: string): string {
  return customers.find((customer) => customer.id === clientId)?.nom ?? "—";
}

export function resolveTruckLabel(camionId: string | null): string {
  if (!camionId) return "Comptoir";
  const truck = trucks.find((item) => item.id === camionId);
  return truck ? `${truck.code} · ${truck.nom}` : "—";
}

export function resolveDistributeurName(distributeurId: string): string {
  return users.find((user) => user.id === distributeurId)?.nom ?? "—";
}

export function resolvePaymentLabel(mode: string): string {
  return paymentMethods.find((method) => method.value === mode)?.label ?? mode;
}

export function resolveProductName(productId: string): string {
  return products.find((product) => product.id === productId)?.designation ?? "—";
}
