import type { PaymentMethodValue } from "@/lib/mock-data/payment-methods";

export type SessionStatus = "ouverte" | "fermee";

export type SalesSession = {
  id: string;
  numero: string; // "POS/8"
  dateOuverture: Date;
  dateFermeture: Date | null;
  statut: SessionStatus;
};

export type InvoiceStatus = "payee" | "en_attente" | "annulee";

export type SaleOrigin = "COUNTER" | "TRUCK";

export type SaleInvoiceLine = {
  productId: string;
  quantite: number;
  prixUnitaire: number;
  remisePercent: number;
  tauxTVA: number;
};

export type SaleInvoice = {
  id: string;
  numero: string; // "42/2026"
  annee: number;
  sessionId: string;
  date: Date;
  clientId: string;
  camionId: string | null;
  distributeurId: string;
  modeReglement: PaymentMethodValue;
  statut: InvoiceStatus;
  lignes: SaleInvoiceLine[];
  origin?: SaleOrigin;
  driverId?: string;
  driverName?: string;
  truckId?: string;
  truckCode?: string;
  tourId?: string;
  createdByUserId?: string;
  createdByUserName?: string;
};

export type MonthlySales = {
  key: string; // "2026-01"
  label: string; // "Janvier 2026"
  nombreCommandes: number;
  caHT: number;
  tva: number;
  caTTC: number;
  totalRemboursements: number;
  benefice: number;
};
