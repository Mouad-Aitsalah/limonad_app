import { saleInvoices } from "@/lib/mock-data/sales";
import { resolveCreditNoteDestination } from "@/lib/credit-note-calculations";
import type { CreditNote } from "@/types/credit-note";
import { customers } from "@/lib/mock-data/customers";

const firstInvoice = saleInvoices[0];
const secondInvoice = saleInvoices.find((invoice) => invoice.camionId !== null) ?? saleInvoices[1];
const firstDestination = resolveCreditNoteDestination(firstInvoice);
const secondDestination = resolveCreditNoteDestination(secondInvoice);
const customerNameById = new Map(customers.map((customer) => [customer.id, customer.nom]));

export const creditNotes: CreditNote[] = [
  {
    id: "credit-note-1",
    number: "AV-2026-001",
    partyType: "client",
    invoiceId: firstInvoice.id,
    invoiceNumber: firstInvoice.numero,
    customerId: firstInvoice.clientId,
    customerName: customerNameById.get(firstInvoice.clientId) ?? firstInvoice.clientId,
    supplierId: null,
    supplierName: null,
    supplierCode: null,
    origin: "facture",
    saleOrigin: firstDestination.saleOrigin,
    truckId: firstInvoice.camionId,
    sourceLabel: firstInvoice.numero,
    tourneeClosed: firstDestination.tourneeClosed,
    stockDestinationLocationId: firstDestination.destinationLocationId,
    stockDestinationLocationName: firstDestination.label,
    stockSourceLocationId: null,
    stockSourceLocationName: null,
    reason: "erreur_quantite",
    comment: "Retour partiel apres controle client.",
    returnDate: "2026-07-18T10:15:00.000Z",
    status: "VALIDE",
    lines: [
      {
        productId: firstInvoice.lignes[0].productId,
        quantityReturned: 1,
        unitPrice: firstInvoice.lignes[0].prixUnitaire,
        discountPercent: firstInvoice.lignes[0].remisePercent,
        taxRate: firstInvoice.lignes[0].tauxTVA,
      },
    ],
    createdBy: "Mouad",
    validatedBy: "Responsable depot",
    validatedAt: "2026-07-18T10:25:00.000Z",
    createdAt: "2026-07-18T10:15:00.000Z",
    updatedAt: "2026-07-18T10:25:00.000Z",
  },
  {
    id: "credit-note-2",
    number: "AV-2026-002",
    partyType: "client",
    invoiceId: secondInvoice.id,
    invoiceNumber: secondInvoice.numero,
    customerId: secondInvoice.clientId,
    customerName: customerNameById.get(secondInvoice.clientId) ?? secondInvoice.clientId,
    supplierId: null,
    supplierName: null,
    supplierCode: null,
    origin: "facture",
    saleOrigin: secondDestination.saleOrigin,
    truckId: secondInvoice.camionId,
    sourceLabel: secondInvoice.numero,
    tourneeClosed: secondDestination.tourneeClosed,
    stockDestinationLocationId: secondDestination.destinationLocationId,
    stockDestinationLocationName: secondDestination.label,
    stockSourceLocationId: null,
    stockSourceLocationName: null,
    reason: "produit_endommage",
    comment: "Produit endommage au dechargement.",
    returnDate: "2026-07-22T16:40:00.000Z",
    status: "BROUILLON",
    lines: [
      {
        productId: secondInvoice.lignes[0].productId,
        quantityReturned: 1,
        unitPrice: secondInvoice.lignes[0].prixUnitaire,
        discountPercent: secondInvoice.lignes[0].remisePercent,
        taxRate: secondInvoice.lignes[0].tauxTVA,
      },
    ],
    createdBy: "Caissier depot",
    validatedBy: null,
    validatedAt: null,
    createdAt: "2026-07-22T16:40:00.000Z",
    updatedAt: "2026-07-22T16:40:00.000Z",
  },
];
