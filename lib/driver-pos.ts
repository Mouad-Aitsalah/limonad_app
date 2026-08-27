import { customers } from "@/lib/mock-data/customers";
import { driverTours } from "@/lib/mock-data/driver-tours";
import { drivers } from "@/lib/mock-data/drivers";
import { products } from "@/lib/mock-data/products";
import { saleInvoices } from "@/lib/mock-data/sales";
import { stockLocations, truckStock } from "@/lib/mock-data/stock";
import { trucks } from "@/lib/mock-data/trucks";
import { computeInvoiceTotals } from "@/lib/sales-calculations";
import { roundCurrency } from "@/lib/utils";
import type { PaymentMethodValue } from "@/lib/mock-data/payment-methods";
import type { CartLine, CartLineComputed, CartTotals } from "@/components/pos/pos-layout";
import type { Product } from "@/types/product";
import type { SaleInvoice, SaleInvoiceLine } from "@/types/sale";
import type { TruckStock } from "@/types/stock";

export type DriverTruckProduct = Product & {
  truckStockQuantity: number;
};

export type DriverPosContext = {
  driverId: string;
  driverName: string;
  truckId: string | null;
  truckCode: string | null;
  truckLabel: string | null;
  truckRegistration: string | null;
  tourId: string | null;
  hasActiveTour: boolean;
  products: DriverTruckProduct[];
};

export function getDriverPosContext(
  driverId: string,
  truckStockItems: TruckStock[] = truckStock,
): DriverPosContext {
  const driver = drivers.find((item) => item.id === driverId);
  const truck = trucks.find((item) => item.chauffeurId === driverId) ?? null;
  const tour =
    truck &&
    driverTours.find(
      (item) =>
        item.driverId === driverId &&
        item.truckId === truck.id &&
        item.status === "ACTIVE",
    );
  const location = truck
    ? stockLocations.find((item) => item.truckId === truck.id)
    : null;
  const stockItems = location
    ? truckStockItems.filter(
        (item) => item.locationId === location.id && item.quantity > 0,
      )
    : [];

  const availableProducts = stockItems.flatMap((item) => {
    const product = products.find(
      (candidate) => candidate.id === item.productId && candidate.actif,
    );
    if (!product) return [];

    return {
      ...product,
      quantiteStock: item.quantity,
      truckStockQuantity: item.quantity,
    };
  });

  return {
    driverId,
    driverName: driver?.nom ?? "Chauffeur",
    truckId: truck?.id ?? null,
    truckCode: truck?.code ?? null,
    truckLabel: truck?.nom ?? null,
    truckRegistration: truck?.immatriculation ?? null,
    tourId: tour?.id ?? null,
    hasActiveTour: Boolean(tour),
    products: availableProducts,
  };
}

export function computeDriverCartLines(
  cart: CartLine[],
  productById: Map<string, DriverTruckProduct>,
): CartLineComputed[] {
  return cart.flatMap((line) => {
    const product = productById.get(line.productId);
    if (!product) return [];

    const unitPriceTTC = product.prixVenteDetail;
    const unitPriceHT = roundCurrency(unitPriceTTC / (1 + product.tauxTVA / 100));
    const baseHT = unitPriceHT * line.quantity;
    const discountAmount = baseHT * (line.discountPercent / 100);
    const netHT = baseHT - discountAmount;
    const tvaAmount = netHT * (product.tauxTVA / 100);
    const totalTTC = netHT + tvaAmount;

    return {
      productId: line.productId,
      designation: product.designation,
      reference: product.reference,
      quantity: line.quantity,
      discountPercent: line.discountPercent,
      unitPriceHT,
      unitPriceTTC,
      tauxTVA: product.tauxTVA,
      baseHT,
      discountAmount,
      netHT,
      tvaAmount,
      totalTTC,
      transferValue: product.prixAchatTTC * line.quantity,
    };
  });
}

export function computeDriverCartTotals(lines: CartLineComputed[]): CartTotals {
  const sousTotalHT = roundCurrency(lines.reduce((sum, line) => sum + line.baseHT, 0));
  const remise = roundCurrency(
    lines.reduce((sum, line) => sum + line.discountAmount, 0),
  );
  const tva = roundCurrency(lines.reduce((sum, line) => sum + line.tvaAmount, 0));
  const totalTTC = roundCurrency(sousTotalHT - remise + tva);
  const transferValue = roundCurrency(
    lines.reduce((sum, line) => sum + line.transferValue, 0),
  );

  return { sousTotalHT, remise, tva, totalTTC, netAPayer: totalTTC, transferValue };
}

export function generateDriverInvoiceNumber(driverName: string, sequence: number) {
  const initials = driverName
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase())
    .join("")
    .slice(0, 3);

  return `VC-${initials}-${String(sequence).padStart(6, "0")}`;
}

export function createDriverSaleInvoice({
  context,
  customerId,
  paymentMethod,
  lines,
  sequence,
}: {
  context: DriverPosContext;
  customerId: string;
  paymentMethod: PaymentMethodValue;
  lines: CartLineComputed[];
  sequence: number;
}): SaleInvoice {
  const invoiceLines: SaleInvoiceLine[] = lines.map((line) => ({
    productId: line.productId,
    quantite: line.quantity,
    prixUnitaire: line.unitPriceHT,
    remisePercent: line.discountPercent,
    tauxTVA: line.tauxTVA,
  }));

  return {
    id: `driver-sale-${Date.now()}`,
    numero: generateDriverInvoiceNumber(context.driverName, sequence),
    annee: 2026,
    sessionId: context.tourId ?? "tour-missing",
    date: new Date(),
    clientId: customerId,
    camionId: context.truckId,
    distributeurId: context.driverId,
    modeReglement: paymentMethod,
    statut: "payee",
    lignes: invoiceLines,
    origin: "TRUCK",
    driverId: context.driverId,
    driverName: context.driverName,
    truckId: context.truckId ?? undefined,
    truckCode: context.truckCode ?? undefined,
    tourId: context.tourId ?? undefined,
    createdByUserId: context.driverId,
    createdByUserName: context.driverName,
  };
}

export function getDriverSales(driverId: string, extraInvoices: SaleInvoice[] = []) {
  return [...extraInvoices, ...saleInvoices]
    .filter((invoice) => invoice.origin === "TRUCK" && invoice.driverId === driverId)
    .sort((a, b) => b.date.getTime() - a.date.getTime());
}

export function getCustomerName(
  customerId: string,
  customerList = customers,
) {
  return customerList.find((customer) => customer.id === customerId)?.nom ?? "Client";
}

export function getInvoiceItemCount(invoice: SaleInvoice) {
  return computeInvoiceTotals(invoice).nombreArticles;
}
