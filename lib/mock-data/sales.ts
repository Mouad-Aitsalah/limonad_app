import { customers, defaultCustomerId } from "@/lib/mock-data/customers";
import { paymentMethods, type PaymentMethodValue } from "@/lib/mock-data/payment-methods";
import { products } from "@/lib/mock-data/products";
import { trucks } from "@/lib/mock-data/trucks";
import { drivers } from "@/lib/mock-data/drivers";
import type {
  InvoiceStatus,
  SaleInvoice,
  SaleInvoiceLine,
  SalesSession,
} from "@/types/sale";

/**
 * Générateur déterministe (seed fixe) : mêmes données à chaque exécution,
 * côté serveur comme côté client — évite tout risque d'hydratation Next.js.
 */
function mulberry32(seed: number) {
  let state = seed;
  return function random() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(20260130);

function randInt(min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

function pickWeighted<T>(entries: Array<[T, number]>): T {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1][0];
}

const sellableProducts = products.filter((product) => product.actif);
const clientIds = customers.map((customer) => customer.id);

// Camions actuellement affectés à un chauffeur (seuls candidats à une vente en tournée).
const activeTrucks = trucks
  .filter((truck) => truck.chauffeurId !== null)
  .map((truck) => ({ id: truck.id, chauffeurId: truck.chauffeurId as string }));

const cashierDistributeurId = "user-cashier";

const months2026 = [0, 1, 2, 3, 4, 5, 6]; // Janvier -> Juillet 2026

function buildSession(index: number, date: Date, closed: boolean): SalesSession {
  const dateOuverture = new Date(date);
  dateOuverture.setHours(8, 0, 0, 0);

  const dateFermeture = closed ? new Date(date) : null;
  if (dateFermeture) {
    dateFermeture.setHours(19, 30, 0, 0);
  }

  return {
    id: `session-${index}`,
    numero: `POS/${index}`,
    dateOuverture,
    dateFermeture,
    statut: closed ? "fermee" : "ouverte",
  };
}

function buildInvoiceLine(): SaleInvoiceLine {
  const product = pick(sellableProducts);
  return {
    productId: product.id,
    quantite: randInt(1, 5),
    prixUnitaire: product.prixVenteDetail,
    remisePercent: pickWeighted<number>([
      [0, 6],
      [5, 2],
      [10, 1],
    ]),
    tauxTVA: product.tauxTVA,
  };
}

function buildInvoice(
  numero: number,
  session: SalesSession,
  hourOffset: number,
): SaleInvoice {
  const date = new Date(session.dateOuverture);
  date.setHours(8 + hourOffset, randInt(0, 59), 0, 0);

  const isVanSale = activeTrucks.length > 0 && rng() < 0.55;
  const truck = isVanSale ? pick(activeTrucks) : null;
  const truckDetails = truck ? trucks.find((item) => item.id === truck.id) : null;
  const driver = truck ? drivers.find((item) => item.id === truck.chauffeurId) : null;

  const modeReglement = pickWeighted<PaymentMethodValue>(
    paymentMethods.map((method) => [
      method.value,
      method.value === "credit" ? 1 : method.value === "especes" ? 5 : 2,
    ]),
  );

  const statut: InvoiceStatus =
    rng() < 0.04
      ? "annulee"
      : modeReglement === "credit" && rng() < 0.4
        ? "en_attente"
        : "payee";

  const lineCount = randInt(1, 4);
  const lignes = Array.from({ length: lineCount }, () => buildInvoiceLine());

  return {
    id: `invoice-${numero}`,
    numero: `${numero}/2026`,
    annee: 2026,
    sessionId: session.id,
    date,
    clientId: rng() < 0.35 ? defaultCustomerId : pick(clientIds),
    camionId: truck?.id ?? null,
    distributeurId: truck?.chauffeurId ?? cashierDistributeurId,
    modeReglement,
    statut,
    lignes,
    origin: truck ? "TRUCK" : "COUNTER",
    driverId: truck?.chauffeurId,
    driverName: driver?.nom,
    truckId: truck?.id,
    truckCode: truckDetails?.code,
    tourId: truck ? `tour-${truck.id}-active` : undefined,
    createdByUserId: truck?.chauffeurId ?? cashierDistributeurId,
    createdByUserName: driver?.nom ?? "Caissier Principal",
  };
}

function generateSalesData(): { sessions: SalesSession[]; invoices: SaleInvoice[] } {
  const sessions: SalesSession[] = [];
  const invoices: SaleInvoice[] = [];

  let sessionIndex = 1;
  let invoiceNumero = 1;

  for (const monthIndex of months2026) {
    const dayOffsets = [3, 10, 17, 24];

    for (const day of dayOffsets) {
      const isLastSessionOfDataset =
        monthIndex === months2026[months2026.length - 1] &&
        day === dayOffsets[dayOffsets.length - 1];

      const date = new Date(2026, monthIndex, day);
      const session = buildSession(sessionIndex, date, !isLastSessionOfDataset);
      sessions.push(session);

      const invoiceCount = randInt(4, 8);
      for (let i = 0; i < invoiceCount; i += 1) {
        invoices.push(
          buildInvoice(invoiceNumero, session, Math.floor((i / invoiceCount) * 10)),
        );
        invoiceNumero += 1;
      }

      sessionIndex += 1;
    }
  }

  return { sessions, invoices };
}

export const { sessions: salesSessions, invoices: saleInvoices } = generateSalesData();
