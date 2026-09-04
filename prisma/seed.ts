import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

import { PrismaClient } from "../lib/generated/prisma/client";
import { assertNotProduction } from "../lib/server/env-guard";
import { BCRYPT_COST } from "../lib/password-hashing";
import type {
  CustomerStatus,
  CustomerType,
  PaymentMethod,
  PurchaseStatus,
  SaleStatus,
  TruckStatus,
  UserRole,
} from "../lib/generated/prisma/enums";
import { customers } from "../lib/mock-data/customers";
import { depots, defaultDepotId } from "../lib/mock-data/depots";
import { driverTours } from "../lib/mock-data/driver-tours";
import { drivers } from "../lib/mock-data/drivers";
import { products } from "../lib/mock-data/products";
import { purchases } from "../lib/mock-data/purchases";
import { saleInvoices } from "../lib/mock-data/sales";
import { stockLocations, truckStock, warehouseStock } from "../lib/mock-data/stock";
import { suppliers } from "../lib/mock-data/suppliers";
import { trucks } from "../lib/mock-data/trucks";
import { users } from "../lib/mock-data/users";
import { computeInvoiceTotals, computeLineTotals } from "../lib/sales-calculations";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  return {
    firstName: parts[0] ?? fullName,
    lastName: parts.slice(1).join(" ") || "-",
  };
}

function role(value: string): UserRole {
  if (value === "admin") return "ADMIN";
  if (value === "driver") return "DRIVER";
  return "CASHIER";
}

function truckStatus(value: string): TruckStatus {
  if (value === "en_tournee") return "ON_TOUR";
  if (value === "en_maintenance") return "MAINTENANCE";
  if (value === "hors_service") return "INACTIVE";
  return "AVAILABLE";
}

function customerType(value: string): CustomerType {
  const map: Record<string, CustomerType> = {
    epicerie: "GROCERY",
    cafe: "CAFE",
    restaurant: "RESTAURANT",
    supermarche: "SUPERMARKET",
    grossiste: "WHOLESALER",
    client_comptoir: "COUNTER",
    autre: "OTHER",
  };
  return map[value] ?? "OTHER";
}

function customerStatus(value: string): CustomerStatus {
  if (value === "bloque") return "BLOCKED";
  if (value === "inactif") return "INACTIVE";
  return "ACTIVE";
}

function paymentMethod(value: string): PaymentMethod {
  const map: Record<string, PaymentMethod> = {
    especes: "CASH",
    cheque: "CHECK",
    carte: "CARD",
    virement: "BANK_TRANSFER",
    credit: "CREDIT",
    credit_fournisseur: "CREDIT",
  };
  return map[value] ?? "CASH";
}

function saleStatus(value: string, payment: string): SaleStatus {
  if (value === "annulee") return "CANCELLED";
  if (value === "en_attente" || payment === "credit") return "CREDIT";
  return "PAID";
}

function purchaseStatus(value: string): PurchaseStatus {
  if (value === "annulee") return "CANCELLED";
  if (value === "en_attente") return "ORDERED";
  return "RECEIVED";
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

const rootOrganizationId = "org-comdis-principal";
const rootOrganizationCode = "COMDIS-PRINCIPAL";
const rootOrganizationName = "COMDIS Principal";
const superAdminId = "user-super-admin";
const superAdminEmail = "superadmin@comdis.local";

/**
 * This script exists to load COMDIS's demo/dev dataset: a synthetic
 * organization, users with a single known password, mock customers,
 * products, sales history, purchases, and tours (see lib/mock-data/*).
 * None of it is real, and every user it creates or updates shares the
 * exact same, publicly-known password - see the hash below.
 *
 * Runs ONLY when ALL hold:
 *   0. assertNotProduction() (lib/server/env-guard.ts) does not throw -
 *      APP_ENV !== "production" AND DATABASE_URL/DIRECT_URL don't match the
 *      known production Neon endpoint
 *   1. NODE_ENV !== "production"
 *   2. ALLOW_DEMO_SEED === "true"
 *
 * Three independent gates on purpose, checked separately (never merged into
 * one condition) so each has its own unambiguous refusal message:
 *
 *  - assertNotProduction() (Phase 4B) is the newest and broadest layer -
 *    it catches both an explicit APP_ENV=production AND the case where
 *    APP_ENV is simply unset/misconfigured but the connection string still
 *    targets the known production Neon endpoint by hostname. Checked FIRST.
 *  - NODE_ENV=production is a second, independent, non-negotiable block -
 *    true regardless of ALLOW_DEMO_SEED. There is no combination of flags
 *    that makes this script acceptable to run against a production
 *    database: it would inject fabricated business records (fake
 *    customers, fake historical sales/purchases) into a real dataset, and
 *    it would create or reset accounts to a password anyone reading this
 *    file already knows.
 *  - ALLOW_DEMO_SEED requires a third, explicit, affirmative opt-in even
 *    outside production - NODE_ENV!=="production" alone used to be
 *    enough, but that is exactly the gap a real test surfaced: a
 *    developer's shell can easily have no NODE_ENV set (so the old check
 *    passed) while DATABASE_URL still points at a real, shared Neon
 *    database rather than a disposable local/demo one. Requiring a
 *    third, differently-named, explicitly-"true" flag makes running this
 *    against the wrong target a deliberate act, not an accident of
 *    default shell state.
 *
 * Same fail-closed pattern already used for AUTH_SECRET and
 * BACKGROUND_TRACKING_SECRET elsewhere in this codebase: refuse loudly,
 * before touching the database, rather than silently do the wrong thing.
 */
async function main() {
  assertNotProduction("prisma/seed.ts");

  if (process.env.NODE_ENV === "production") {
    console.error(
      "[seed] Refuse : NODE_ENV=production. Ce script ne doit jamais etre execute " +
        "contre une base de production, quelle que soit la valeur de ALLOW_DEMO_SEED. " +
        "Aucune donnee n'a ete modifiee.",
    );
    process.exit(1);
  }

  if (process.env.ALLOW_DEMO_SEED !== "true") {
    console.error(
      "[seed] Refuse : ALLOW_DEMO_SEED n'est pas defini a 'true'. Ce script cree/" +
        "reinitialise des comptes de demonstration a mot de passe connu et charge un " +
        "jeu de donnees entierement synthetique (voir prisma/seed.ts) - un simple " +
        "NODE_ENV different de 'production' ne suffit plus, un consentement explicite " +
        "est requis. Definissez ALLOW_DEMO_SEED=true UNIQUEMENT si DATABASE_URL pointe " +
        "vers une base de demonstration jetable, jamais une base partagee ou reelle. " +
        "Aucune donnee n'a ete modifiee.",
    );
    process.exit(1);
  }

  const demoPasswordHash = await bcrypt.hash("123456", BCRYPT_COST);

  await prisma.organization.upsert({
    where: { id: rootOrganizationId },
    update: {
      code: rootOrganizationCode,
      name: rootOrganizationName,
      tradeName: "COMDIS",
      address: depots[0]?.adresse ?? "Casablanca",
      city: "Casablanca",
      country: "Morocco",
      email: "contact@comdis.local",
      status: "ACTIVE",
    },
    create: {
      id: rootOrganizationId,
      code: rootOrganizationCode,
      name: rootOrganizationName,
      tradeName: "COMDIS",
      address: depots[0]?.adresse ?? "Casablanca",
      city: "Casablanca",
      country: "Morocco",
      email: "contact@comdis.local",
      status: "ACTIVE",
    },
  });

  await prisma.user.upsert({
    where: { id: superAdminId },
    update: {
      firstName: "Super",
      lastName: "Admin",
      fullName: "Super Admin COMDIS",
      email: superAdminEmail,
      passwordHash: demoPasswordHash,
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      organizationId: null,
      depotId: null,
    },
    create: {
      id: superAdminId,
      firstName: "Super",
      lastName: "Admin",
      fullName: "Super Admin COMDIS",
      email: superAdminEmail,
      passwordHash: demoPasswordHash,
      role: "SUPER_ADMIN",
      status: "ACTIVE",
    },
  });

  for (const depot of depots) {
    await prisma.depot.upsert({
      where: { id: depot.id },
      update: {
        organizationId: rootOrganizationId,
        code: "DEP-01",
        name: depot.nom,
        address: depot.adresse,
        city: "Casablanca",
        active: true,
      },
      create: {
        organizationId: rootOrganizationId,
        id: depot.id,
        code: "DEP-01",
        name: depot.nom,
        address: depot.adresse,
        city: "Casablanca",
        active: true,
      },
    });
  }

  for (const user of users) {
    const { firstName, lastName } = splitName(user.nom);
    await prisma.user.upsert({
      where: { id: user.id },
      update: {
        organizationId: rootOrganizationId,
        passwordHash: demoPasswordHash,
        role: role(user.role),
        status: user.actif ? "ACTIVE" : "INACTIVE",
        depotId: defaultDepotId,
      },
      create: {
        id: user.id,
        organizationId: rootOrganizationId,
        firstName,
        lastName,
        fullName: user.nom,
        email: user.email,
        passwordHash: demoPasswordHash,
        role: role(user.role),
        status: user.actif ? "ACTIVE" : "INACTIVE",
        depotId: defaultDepotId,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  }

  await prisma.accountingSettings.upsert({
    where: { organizationId: rootOrganizationId },
    update: { updatedByUserId: "user-admin" },
    create: {
      organizationId: rootOrganizationId,
      updatedByUserId: "user-admin",
    },
  });

  for (const driver of drivers) {
    const driverUser = users.find((user) => user.id === driver.id);
    await prisma.driver.upsert({
      where: { id: driver.id },
      update: {
        organizationId: rootOrganizationId,
        employeeCode: `DRV-${driver.id.split("-").at(-1)?.padStart(4, "0") ?? driver.id}`,
        userId: driver.id,
        phone: driverUser?.telephone,
        active: driverUser?.actif ?? true,
      },
      create: {
        organizationId: rootOrganizationId,
        id: driver.id,
        employeeCode: `DRV-${driver.id.split("-").at(-1)?.padStart(4, "0") ?? driver.id}`,
        userId: driver.id,
        phone: driverUser?.telephone,
        active: driverUser?.actif ?? true,
      },
    });
  }

  for (const truck of trucks) {
    await prisma.truck.upsert({
      where: { id: truck.id },
      update: {
        organizationId: rootOrganizationId,
        code: truck.code,
        registration: truck.immatriculation,
        brand: truck.marque,
        model: truck.modele,
        capacity: truck.capacite,
        status: truckStatus(truck.statut),
        depotId: truck.depotId,
        defaultDriverId: truck.chauffeurId,
        createdAt: truck.createdAt,
        updatedAt: truck.updatedAt,
      },
      create: {
        organizationId: rootOrganizationId,
        id: truck.id,
        code: truck.code,
        registration: truck.immatriculation,
        brand: truck.marque,
        model: truck.modele,
        capacity: truck.capacite,
        status: truckStatus(truck.statut),
        depotId: truck.depotId,
        defaultDriverId: truck.chauffeurId,
        createdAt: truck.createdAt,
        updatedAt: truck.updatedAt,
      },
    });
  }

  for (const truck of trucks.filter((item) => item.chauffeurId)) {
    await prisma.driver.update({
      where: { id: truck.chauffeurId as string },
      data: { truckId: truck.id },
    });
  }

  for (const supplier of suppliers) {
    await prisma.supplier.upsert({
      where: { id: supplier.id },
      update: {
        organizationId: rootOrganizationId,
        code: supplier.id,
        name: supplier.nom,
        phone: supplier.telephone,
        email: supplier.email,
        address: supplier.adresse,
        city: "Casablanca",
      },
      create: {
        organizationId: rootOrganizationId,
        id: supplier.id,
        code: supplier.id,
        name: supplier.nom,
        phone: supplier.telephone,
        email: supplier.email,
        address: supplier.adresse,
        city: "Casablanca",
      },
    });
  }

  const categoryIds = Array.from(new Set(products.map((product) => product.categorieId)));
  for (const categoryId of categoryIds) {
    await prisma.category.upsert({
      where: { id: categoryId },
      update: {
        organizationId: rootOrganizationId,
        code: categoryId,
        name: categoryId.replace(/^cat-/, "").replaceAll("-", " "),
      },
      create: {
        organizationId: rootOrganizationId,
        id: categoryId,
        code: categoryId,
        name: categoryId.replace(/^cat-/, "").replaceAll("-", " "),
      },
    });
  }

  const brandIds = Array.from(new Set(products.map((product) => product.marqueId)));
  for (const brandId of brandIds) {
    await prisma.brand.upsert({
      where: { id: brandId },
      update: {
        organizationId: rootOrganizationId,
        name: brandId.replace(/^marque-/, "").replaceAll("-", " "),
      },
      create: {
        organizationId: rootOrganizationId,
        id: brandId,
        name: brandId.replace(/^marque-/, "").replaceAll("-", " "),
      },
    });
  }

  for (const product of products) {
    await prisma.product.upsert({
      where: { id: product.id },
      update: {
        organizationId: rootOrganizationId,
        reference: product.reference,
        barcode: product.codeBarres,
        name: product.designation,
        categoryId: product.categorieId,
        brandId: product.marqueId,
        defaultSupplierId: product.fournisseurId,
        purchasePrice: product.prixAchatHT,
        salePrice: product.prixVenteDetail,
        taxRate: product.tauxTVA,
        unit: product.unite,
        minimumStock: product.stockAlerte,
        status: product.actif ? "ACTIVE" : "INACTIVE",
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
      },
      create: {
        organizationId: rootOrganizationId,
        id: product.id,
        reference: product.reference,
        barcode: product.codeBarres,
        name: product.designation,
        categoryId: product.categorieId,
        brandId: product.marqueId,
        defaultSupplierId: product.fournisseurId,
        purchasePrice: product.prixAchatHT,
        salePrice: product.prixVenteDetail,
        taxRate: product.tauxTVA,
        unit: product.unite,
        minimumStock: product.stockAlerte,
        status: product.actif ? "ACTIVE" : "INACTIVE",
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
      },
    });
  }

  for (const location of stockLocations) {
    await prisma.stockLocation.upsert({
      where: { id: location.id },
      update: {
        organizationId: rootOrganizationId,
        code: location.code,
        name: location.name,
        type: location.type === "warehouse" ? "DEPOT" : "TRUCK",
        depotId: location.type === "warehouse" ? defaultDepotId : null,
        truckId: location.truckId ?? null,
        active: location.active,
      },
      create: {
        organizationId: rootOrganizationId,
        id: location.id,
        code: location.code,
        name: location.name,
        type: location.type === "warehouse" ? "DEPOT" : "TRUCK",
        depotId: location.type === "warehouse" ? defaultDepotId : undefined,
        truckId: location.truckId ?? undefined,
        active: location.active,
      },
    });
  }

  // F6 fix (Phase 2 audit, finding F6): a StockLevel row that already exists
  // - from an earlier seed run, or from real app usage - must never have its
  // quantity silently overwritten here. Only a row that does not exist yet
  // gets an initial quantity, and (when that quantity is non-zero) it is
  // always paired, in the same transaction, with an explicit opening
  // StockMovement so the row starts in sync with the ledger instead of
  // reproducing the same untracked-quantity gap Audit 11 found. This script
  // never recomputes or repairs an existing StockLevel from StockMovement
  // history, and it does not touch the 59 pre-existing divergences found
  // during that audit - those stay exactly as they are.
  let seedMovementSequence = await prisma.stockMovement.count({
    where: { organizationId: rootOrganizationId },
  });
  let stockLevelsInitialized = 0;
  let stockLevelsUntouched = 0;

  for (const item of [...warehouseStock, ...truckStock]) {
    const existingLevel = await prisma.stockLevel.findUnique({
      where: {
        productId_locationId: {
          productId: item.productId,
          locationId: item.locationId,
        },
      },
      select: { id: true },
    });

    if (existingLevel) {
      stockLevelsUntouched += 1;
      continue;
    }

    if (item.quantity === 0) {
      // Nothing to trace: an opening quantity of zero needs no movement,
      // same convention already used elsewhere (finalizeInventory /
      // applyStockMovement never create a movement for a zero delta).
      await prisma.stockLevel.create({
        data: {
          id: item.id,
          organizationId: rootOrganizationId,
          productId: item.productId,
          locationId: item.locationId,
          quantity: 0,
        },
      });
      stockLevelsInitialized += 1;
      continue;
    }

    seedMovementSequence += 1;
    // MV-SEED- prefix (not nextMovementNumber's plain MV-<n>) so an opening
    // balance created by this script is always trivially distinguishable
    // from a real application-generated movement, and can never collide
    // with one.
    const movementNumber = `MV-SEED-${String(seedMovementSequence).padStart(6, "0")}`;

    await prisma.$transaction([
      prisma.stockLevel.create({
        data: {
          id: item.id,
          organizationId: rootOrganizationId,
          productId: item.productId,
          locationId: item.locationId,
          quantity: item.quantity,
        },
      }),
      prisma.stockMovement.create({
        data: {
          organizationId: rootOrganizationId,
          movementNumber,
          type: "INVENTORY_ADJUSTMENT",
          productId: item.productId,
          quantity: item.quantity,
          sourceLocationId: null,
          destinationLocationId: item.locationId,
          referenceType: "SEED_INITIAL",
          referenceId: null,
          reason: "Stock d'ouverture (seed)",
          note: "Quantite d'ouverture creee par prisma/seed.ts - aucun historique reel avant ce mouvement.",
          createdByUserId: "user-admin",
          status: "VALIDATED",
        },
      }),
    ]);
    stockLevelsInitialized += 1;
  }

  console.log(
    `[seed] StockLevel : ${stockLevelsInitialized} ligne(s) initialisee(s) avec mouvement d'ouverture trace, ` +
      `${stockLevelsUntouched} ligne(s) existante(s) laissee(s) intacte(s) (quantity non modifiee).`,
  );

  const requiredTourIds = new Set(driverTours.map((tour) => tour.id));
  for (const invoice of saleInvoices.filter((item) => item.tourId && !requiredTourIds.has(item.tourId))) {
    const truck = trucks.find((item) => item.id === invoice.truckId);
    if (!truck?.chauffeurId || !invoice.tourId) continue;
    requiredTourIds.add(invoice.tourId);
    driverTours.push({
      id: invoice.tourId,
      code: `TOUR-${truck.code}`,
      driverId: truck.chauffeurId,
      truckId: truck.id,
      date: new Date("2026-07-30T08:00:00"),
      status: "ACTIVE",
      departureAt: new Date("2026-07-30T08:00:00"),
      returnAt: null,
    });
  }

  for (const tour of driverTours) {
    const seededTourStatus = tour.status === "ACTIVE" ? "LOADED" : "CLOSED";
    await prisma.tour.upsert({
      where: { id: tour.id },
      update: {
        organizationId: rootOrganizationId,
        code: tour.code,
        date: tour.date,
        depotId: defaultDepotId,
        truckId: tour.truckId,
        driverId: tour.driverId,
        status: seededTourStatus,
        startedAt: seededTourStatus === "CLOSED" ? tour.departureAt : null,
        returnedAt: tour.returnAt,
        closedAt: seededTourStatus === "CLOSED" ? tour.returnAt : null,
        createdByUserId: "user-admin",
      },
      create: {
        id: tour.id,
        organizationId: rootOrganizationId,
        code: tour.code,
        date: tour.date,
        depotId: defaultDepotId,
        truckId: tour.truckId,
        driverId: tour.driverId,
        status: seededTourStatus,
        startedAt: seededTourStatus === "CLOSED" ? tour.departureAt : null,
        returnedAt: tour.returnAt,
        closedAt: seededTourStatus === "CLOSED" ? tour.returnAt : null,
        createdByUserId: "user-admin",
      },
    });

    const loadingId = `loading-${tour.id}`;
    const loadingLines = warehouseStock.slice(0, 3).map((stockItem) => ({
      loadingId,
      productId: stockItem.productId,
      quantity: Math.min(5, Math.max(1, stockItem.quantity)),
    }));

    const seededLoading = await prisma.truckLoading.upsert({
      where: { tourId: tour.id },
      update: {
        organizationId: rootOrganizationId,
        depotId: defaultDepotId,
        truckId: tour.truckId,
        driverId: tour.driverId,
        date: tour.date,
        status: "VALIDATED",
        validatedAt: tour.date,
        validatedByUserId: "user-admin",
        createdByUserId: "user-admin",
      },
      create: {
        id: loadingId,
        organizationId: rootOrganizationId,
        loadingNumber: `CHG-SEED-${tour.id.slice(-6).toUpperCase()}`,
        tourId: tour.id,
        depotId: defaultDepotId,
        truckId: tour.truckId,
        driverId: tour.driverId,
        date: tour.date,
        status: "VALIDATED",
        validatedAt: tour.date,
        validatedByUserId: "user-admin",
        createdByUserId: "user-admin",
      },
    });

    await prisma.truckLoadingLine.deleteMany({ where: { loadingId: seededLoading.id } });
    await prisma.truckLoadingLine.createMany({
      data: loadingLines.map((line) => ({
        ...line,
        loadingId: seededLoading.id,
      })),
      skipDuplicates: true,
    });
  }

  for (const customer of customers) {
    await prisma.customer.upsert({
      where: { id: customer.id },
      update: {
        organizationId: rootOrganizationId,
        code: customer.code,
        name: customer.nom,
        phone: customer.telephone,
        email: customer.email,
        address: customer.adresse,
        city: customer.ville,
        type: customerType(customer.type),
        status: customerStatus(customer.statut),
        creditLimit: customer.plafondCredit,
        currentBalance: customer.creditUtilise,
        ice: customer.ice,
        taxId: customer.identifiantFiscal,
        contactName: customer.contactPrincipal,
        notes: customer.notes,
        createdByUserId: customer.createdByUserId,
        createdByDriverId: customer.createdByDriverId,
        createdFromTruckId: customer.createdFromTruckId,
        creationOrigin: customer.creationOrigin,
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt,
      },
      create: {
        id: customer.id,
        organizationId: rootOrganizationId,
        code: customer.code,
        name: customer.nom,
        phone: customer.telephone,
        email: customer.email,
        address: customer.adresse,
        city: customer.ville,
        type: customerType(customer.type),
        status: customerStatus(customer.statut),
        creditLimit: customer.plafondCredit,
        currentBalance: customer.creditUtilise,
        ice: customer.ice,
        taxId: customer.identifiantFiscal,
        contactName: customer.contactPrincipal,
        notes: customer.notes,
        createdByUserId: customer.createdByUserId,
        createdByDriverId: customer.createdByDriverId,
        createdFromTruckId: customer.createdFromTruckId,
        creationOrigin: customer.creationOrigin,
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt,
      },
    });
  }

  for (const invoice of saleInvoices) {
    const totals = computeInvoiceTotals(invoice);
    const method = paymentMethod(invoice.modeReglement);
    const status = saleStatus(invoice.statut, invoice.modeReglement);
    const stockLocation =
      invoice.truckId
        ? stockLocations.find((location) => location.truckId === invoice.truckId)
        : stockLocations.find((location) => location.type === "warehouse");

    await prisma.sale.upsert({
      where: { id: invoice.id },
      update: {
        organizationId: rootOrganizationId,
        invoiceNumber: invoice.numero,
        origin: invoice.origin ?? (invoice.truckId ? "TRUCK" : "COUNTER"),
        status,
        customerId: invoice.clientId,
        depotId: invoice.truckId ? null : defaultDepotId,
        driverId: invoice.driverId,
        truckId: invoice.truckId,
        tourId: invoice.tourId,
        stockLocationId: stockLocation?.id ?? "loc-main-warehouse",
        subtotalHT: totals.totalHT,
        discountAmount: 0,
        taxAmount: totals.totalTVA,
        totalTTC: totals.totalTTC,
        paidAmount: method === "CREDIT" ? 0 : totals.totalTTC,
        creditAmount: method === "CREDIT" ? totals.totalTTC : 0,
        paymentMethod: method,
        createdByUserId: invoice.createdByUserId ?? invoice.distributeurId,
        validatedAt: status === "CANCELLED" ? null : invoice.date,
        createdAt: invoice.date,
        updatedAt: invoice.date,
      },
      create: {
        id: invoice.id,
        organizationId: rootOrganizationId,
        invoiceNumber: invoice.numero,
        origin: invoice.origin ?? (invoice.truckId ? "TRUCK" : "COUNTER"),
        status,
        customerId: invoice.clientId,
        depotId: invoice.truckId ? null : defaultDepotId,
        driverId: invoice.driverId,
        truckId: invoice.truckId,
        tourId: invoice.tourId,
        stockLocationId: stockLocation?.id ?? "loc-main-warehouse",
        subtotalHT: totals.totalHT,
        discountAmount: 0,
        taxAmount: totals.totalTVA,
        totalTTC: totals.totalTTC,
        paidAmount: method === "CREDIT" ? 0 : totals.totalTTC,
        creditAmount: method === "CREDIT" ? totals.totalTTC : 0,
        paymentMethod: method,
        createdByUserId: invoice.createdByUserId ?? invoice.distributeurId,
        validatedAt: status === "CANCELLED" ? undefined : invoice.date,
        createdAt: invoice.date,
        updatedAt: invoice.date,
        lines: {
          create: invoice.lignes.map((line, index) => {
            const lineTotals = computeLineTotals(line);
            // BI Phase 2A: seed data has no recorded historical cost either,
            // so this mirrors the migration's own backfill - the product's
            // current purchasePrice, an approximation for demo data.
            const product = products.find((item) => item.id === line.productId);
            return {
              id: `sale-line-${invoice.id}-${index}`,
              productId: line.productId,
              quantity: line.quantite,
              unitPriceHT: line.prixUnitaire,
              unitCostHT: product?.prixAchatHT ?? line.prixUnitaire,
              discountRate: line.remisePercent,
              discountAmount: round(line.prixUnitaire * line.quantite * (line.remisePercent / 100)),
              taxRate: line.tauxTVA,
              taxAmount: lineTotals.tvaAmount,
              totalHT: lineTotals.netHT,
              totalTTC: lineTotals.total,
            };
          }),
        },
      },
    });
  }

  for (const purchase of purchases) {
    const lines = purchase.lignes.map((line) => {
      const totalHT = round(line.prixAchat * line.quantite * (1 - line.remisePercent / 100));
      const product = products.find((item) => item.id === line.productId);
      const taxRate = product?.tauxTVA ?? 20;
      const totalTTC = round(totalHT * (1 + taxRate / 100));
      return { ...line, totalHT, taxRate, totalTTC };
    });
    const subtotalHT = round(lines.reduce((sum, line) => sum + line.totalHT, 0));
    const totalTTC = round(lines.reduce((sum, line) => sum + line.totalTTC, 0));

    await prisma.purchase.upsert({
      where: { id: purchase.id },
      update: {
        organizationId: rootOrganizationId,
        purchaseNumber: purchase.numero,
        supplierId: purchase.fournisseurId,
        depotId: defaultDepotId,
        status: purchaseStatus(purchase.statut),
        orderDate: purchase.date,
        receivedAt: purchase.statut === "validee" ? purchase.date : null,
        subtotalHT,
        taxAmount: round(totalTTC - subtotalHT),
        totalTTC,
        createdByUserId: purchase.utilisateurId,
        validatedByUserId: purchase.statut === "validee" ? purchase.utilisateurId : null,
        createdAt: purchase.createdAt,
        updatedAt: purchase.updatedAt,
      },
      create: {
        id: purchase.id,
        organizationId: rootOrganizationId,
        purchaseNumber: purchase.numero,
        supplierId: purchase.fournisseurId,
        depotId: defaultDepotId,
        status: purchaseStatus(purchase.statut),
        orderDate: purchase.date,
        receivedAt: purchase.statut === "validee" ? purchase.date : undefined,
        subtotalHT,
        taxAmount: round(totalTTC - subtotalHT),
        totalTTC,
        createdByUserId: purchase.utilisateurId,
        validatedByUserId: purchase.statut === "validee" ? purchase.utilisateurId : undefined,
        createdAt: purchase.createdAt,
        updatedAt: purchase.updatedAt,
        lines: {
          create: lines.map((line, index) => ({
            id: `purchase-line-${purchase.id}-${index}`,
            productId: line.productId,
            orderedQuantity: line.quantite,
            receivedQuantity: purchase.statut === "validee" ? line.quantite : 0,
            unitPurchasePrice: line.prixAchat,
            taxRate: line.taxRate,
            totalHT: line.totalHT,
            totalTTC: line.totalTTC,
            createdAt: purchase.createdAt,
            updatedAt: purchase.updatedAt,
          })),
        },
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      userId: "user-admin",
      organizationId: rootOrganizationId,
      action: "SEED_DATABASE",
      entityType: "SYSTEM",
      entityId: "initial-seed",
      newValue: { message: "Initial COMDIS seed completed" },
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
