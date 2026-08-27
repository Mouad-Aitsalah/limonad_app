import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

import { PrismaClient } from "../lib/generated/prisma/client";
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

async function main() {
  const demoPasswordHash = await bcrypt.hash("123456", 12);

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

  for (const item of [...warehouseStock, ...truckStock]) {
    await prisma.stockLevel.upsert({
      where: {
        productId_locationId: {
          productId: item.productId,
          locationId: item.locationId,
        },
      },
      update: {
        organizationId: rootOrganizationId,
        quantity: item.quantity,
      },
      create: {
        id: item.id,
        organizationId: rootOrganizationId,
        productId: item.productId,
        locationId: item.locationId,
        quantity: item.quantity,
      },
    });
  }

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
            return {
              id: `sale-line-${invoice.id}-${index}`,
              productId: line.productId,
              quantity: line.quantite,
              unitPriceHT: line.prixUnitaire,
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
