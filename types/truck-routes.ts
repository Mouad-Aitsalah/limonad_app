export type TruckRouteStatus =
  | "DRAFT"
  | "PREPARED"
  | "LOADED"
  | "IN_PROGRESS"
  | "WAITING_FOR_CLOSURE"
  | "CLOSED"
  | "CANCELLED"
  | "INTERRUPTED";

export type TruckRouteVisitStatus =
  | "PENDING"
  | "NEARBY"
  | "ARRIVED"
  | "DELIVERED"
  | "NO_SALE";

export type TruckRouteFilterOption = {
  id: string;
  label: string;
  secondary?: string | null;
};

export type TruckRouteTourOption = {
  id: string;
  code: string;
  truckId: string;
  driverId: string;
  truckLabel: string;
  driverName: string;
  status: TruckRouteStatus;
  startedAt: string | null;
  returnedAt: string | null;
};

export type TruckRoutePointDto = {
  id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  recordedAt: string;
};

export type TruckRouteVisitDto = {
  customerId: string;
  customerCode: string;
  customerName: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  status: TruckRouteVisitStatus;
  firstDetectedAt: string | null;
  arrivedAt: string | null;
  completedAt: string | null;
  noSaleReason: string | null;
  saleCount: number;
  saleAmount: number;
  saleLabel: string | null;
};

export type TruckRouteTimelineEventDto = {
  id: string;
  type: "START" | "VISIT" | "RETURN";
  timestamp: string;
  title: string;
  subtitle: string;
  status?: TruckRouteVisitStatus | TruckRouteStatus | null;
  amount?: number | null;
};

export type TruckRouteSummaryDto = {
  distanceKm: number;
  durationMinutes: number | null;
  pointsCount: number;
  usablePointsCount: number;
  ignoredPointsCount: number;
  clientsVisited: number;
  deliveredCount: number;
  salesCount: number;
  salesAmount: number;
  startedAt: string | null;
  returnedAt: string | null;
  status: TruckRouteStatus;
};

export type TruckRouteDto = {
  tour: {
    id: string;
    code: string;
    date: string;
    status: TruckRouteStatus;
    startedAt: string | null;
    returnedAt: string | null;
    closedAt: string | null;
  };
  truck: {
    id: string;
    code: string;
    registration: string;
  };
  driver: {
    id: string;
    name: string;
  };
  points: TruckRoutePointDto[];
  visits: TruckRouteVisitDto[];
  timeline: TruckRouteTimelineEventDto[];
  summary: TruckRouteSummaryDto;
};

export type TruckRoutesPageData = {
  filters: {
    date: string;
    truckId: string | null;
    driverId: string | null;
    status: TruckRouteStatus | null;
    tourId: string | null;
  };
  filterOptions: {
    trucks: TruckRouteFilterOption[];
    drivers: TruckRouteFilterOption[];
    statuses: Array<{ value: TruckRouteStatus; label: string }>;
    tours: TruckRouteTourOption[];
  };
  route: TruckRouteDto | null;
  message: string | null;
};
