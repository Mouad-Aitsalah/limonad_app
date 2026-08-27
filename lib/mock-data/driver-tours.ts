import type { DriverTour } from "@/types/tour";

export const driverTours: DriverTour[] = [
  {
    id: "tour-truck-1-active",
    code: "TOUR-2026-001",
    driverId: "driver-1",
    truckId: "truck-1",
    date: new Date("2026-07-30T08:00:00"),
    status: "ACTIVE",
    departureAt: new Date("2026-07-30T08:00:00"),
    returnAt: null,
  },
  {
    id: "tour-truck-2-active",
    code: "TOUR-2026-002",
    driverId: "driver-2",
    truckId: "truck-2",
    date: new Date("2026-07-30T08:15:00"),
    status: "ACTIVE",
    departureAt: new Date("2026-07-30T08:15:00"),
    returnAt: null,
  },
  {
    id: "tour-truck-1-closed-1",
    code: "TOUR-2026-000",
    driverId: "driver-1",
    truckId: "truck-1",
    date: new Date("2026-07-24T08:00:00"),
    status: "CLOSED",
    departureAt: new Date("2026-07-24T08:00:00"),
    returnAt: new Date("2026-07-24T18:15:00"),
  },
];
