export type TourStatus = "ACTIVE" | "CLOSED";

export type DriverTour = {
  id: string;
  code: string;
  driverId: string;
  truckId: string;
  date: Date;
  status: TourStatus;
  departureAt: Date;
  returnAt: Date | null;
};

export interface DriverTourSalesSummary {
  tourId: string;
  tourCode: string;
  date: string;
  truckId: string;
  truckCode: string;
  status: string;
  departureAt: Date;
  returnAt: Date | null;
  salesCount: number;
  customersCount: number;
  totalQuantity: number;
  totalHT: number;
  totalTax: number;
  totalTTC: number;
  paidAmount: number;
  creditAmount: number;
}
