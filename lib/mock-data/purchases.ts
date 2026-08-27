import { products } from "@/lib/mock-data/products";
import { suppliers } from "@/lib/mock-data/suppliers";
import type {
  Purchase,
  PurchaseLine,
  PurchasePaymentMethod,
  PurchaseStatus,
} from "@/types/purchase";

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

const rng = mulberry32(20260212);

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

const eligibleProducts = products.filter((product) => product.actif);
const eligibleUsers = ["user-admin", "user-cashier"];

function buildLines(): PurchaseLine[] {
  const lineCount = randInt(1, 5);
  const usedProductIds = new Set<string>();
  const lines: PurchaseLine[] = [];

  while (lines.length < lineCount) {
    const product = pick(eligibleProducts);
    if (usedProductIds.has(product.id)) continue;
    usedProductIds.add(product.id);

    lines.push({
      productId: product.id,
      quantite: randInt(10, 80),
      prixAchat: product.prixAchatHT,
      remisePercent: pickWeighted<number>([
        [0, 6],
        [5, 2],
        [10, 1],
      ]),
    });
  }

  return lines;
}

function buildPurchase(index: number, date: Date): Purchase {
  const modeReglement = pickWeighted<PurchasePaymentMethod>([
    ["especes", 3],
    ["cheque", 3],
    ["virement", 3],
    ["credit_fournisseur", 2],
  ]);

  const isCheque = modeReglement === "cheque";
  const statut: PurchaseStatus =
    rng() < 0.08
      ? "annulee"
      : modeReglement === "credit_fournisseur" && rng() < 0.4
        ? "en_attente"
        : "validee";

  const datePaiement =
    statut === "en_attente"
      ? null
      : (() => {
          const paiement = new Date(date);
          paiement.setDate(paiement.getDate() + randInt(0, 5));
          return paiement;
        })();

  return {
    id: `purchase-${index}`,
    numero: `A-${String(index).padStart(6, "0")}`,
    date,
    fournisseurId: pick(suppliers).id,
    modeReglement,
    numeroCheque: isCheque ? `${randInt(100000, 999999)}` : null,
    banque: isCheque
      ? pick(["Attijariwafa Bank", "Banque Populaire", "BMCE Bank", "CIH Bank"])
      : null,
    datePaiement,
    utilisateurId: pick(eligibleUsers),
    observation: "",
    statut,
    lignes: buildLines(),
    createdAt: date,
    updatedAt: date,
  };
}

function generatePurchases(): Purchase[] {
  const purchases: Purchase[] = [];
  const dayOffsets = [2, 6, 11, 15, 19, 23, 27];

  let index = 1;
  for (const monthIndex of [2, 3, 4, 5, 6]) {
    for (const day of dayOffsets) {
      if (index > 20) break;
      purchases.push(buildPurchase(index, new Date(2026, monthIndex, day)));
      index += 1;
    }
    if (index > 20) break;
  }

  return purchases;
}

export const purchases: Purchase[] = generatePurchases();
