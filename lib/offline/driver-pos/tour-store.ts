"use client";

import type { SQLiteDBConnection } from "@capacitor-community/sqlite";

import type {
  CurrentDriverTourDto,
  DriverTourCustomerDto,
  DriverTourPositionDto,
  DriverTourProximityDto,
  DriverTourStartContextDto,
  DriverTourStopDto,
  DriverTourSummaryDto,
  TourDto,
} from "@/types/operations-dto";

import { nowIso, withDatabase, withTransaction } from "./database";
import type { CachedDriverTour } from "./types";

/**
 * ÉTAPE 28C - "MA TOURNÉE": durable SQLite mirror of GET /api/driver/tour's
 * CurrentDriverTourDto for one driver (schema.ts v5). Reads rebuild the EXACT
 * DTO DriverTourView already consumes, so the historical component needs no
 * cache-aware code at all.
 *
 * Writes replace the driver's whole tour in ONE transaction (delete every
 * child row, insert the new set) - the cache can therefore never hold a
 * half-written or mixed old/new tour. A FAILED network call never reaches this
 * module (see the shell's driver-tour-data-source.ts), so a valid cache is
 * never overwritten by an error or an empty answer; a successful "no active
 * tour" answer IS stored (header row with tourId NULL) so a tour that ended
 * server-side is not shown as still running.
 */

type Scope = { organizationId: string; driverId: string };
type Db = SQLiteDBConnection;

// SQLite's default variable limit is 999 per statement - chunk multi-row
// INSERTs under it. One native call per chunk instead of one per row: a
// day's route can hold thousands of GPS points, and every db.run() is a
// bridge round trip.
const MAX_SQL_VARIABLES = 900;

async function insertRows(db: Db, table: string, columns: string[], rows: unknown[][]): Promise<void> {
  if (rows.length === 0) return;
  const perStatement = Math.max(1, Math.floor(MAX_SQL_VARIABLES / columns.length));
  const rowPlaceholder = `(${columns.map(() => "?").join(", ")})`;
  for (let index = 0; index < rows.length; index += perStatement) {
    const chunk = rows.slice(index, index + perStatement);
    await db.run(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${chunk.map(() => rowPlaceholder).join(", ")}`,
      chunk.flat(),
      false,
    );
  }
}

function json(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function bit(value: boolean): number {
  return value ? 1 : 0;
}

export async function saveCachedDriverTour(scope: Scope, dto: CurrentDriverTourDto): Promise<boolean> {
  const { tour, summary, latestPosition, proximity } = dto;
  const { organizationId, driverId } = scope;

  const header: Record<string, unknown> = {
    organizationId,
    driverId,
    syncedAt: nowIso(),
    message: dto.message,
    canStart: bit(dto.canStart),
    canReturn: bit(dto.canReturn),
    startContextJson: json(dto.startContext),
    tourId: tour?.id ?? null,
    tourCode: tour?.code ?? null,
    tourDate: tour?.date ?? null,
    tourStatus: tour?.status ?? null,
    startedAt: tour?.startedAt ?? null,
    returnedAt: tour?.returnedAt ?? null,
    closedAt: tour?.closedAt ?? null,
    depotId: tour?.depot.id ?? null,
    depotCode: tour?.depot.code ?? null,
    depotName: tour?.depot.name ?? null,
    truckId: tour?.truck.id ?? null,
    truckCode: tour?.truck.code ?? null,
    truckRegistration: tour?.truck.registration ?? null,
    truckStatus: tour?.truck.status ?? null,
    tourDriverId: tour?.driver.id ?? null,
    driverEmployeeCode: tour?.driver.employeeCode ?? null,
    driverName: tour?.driver.name ?? null,
    createdByUserName: tour?.createdByUserName ?? null,
    tourCreatedAt: tour?.createdAt ?? null,
    tourUpdatedAt: tour?.updatedAt ?? null,
    loadingJson: json(tour?.loading),
    stockSheetJson: json(tour?.stockSheet),
    closureJson: json(tour?.closure),
    latestLatitude: latestPosition?.latitude ?? null,
    latestLongitude: latestPosition?.longitude ?? null,
    latestAccuracy: latestPosition?.accuracy ?? null,
    latestSpeed: latestPosition?.speed ?? null,
    latestHeading: latestPosition?.heading ?? null,
    latestRecordedAt: latestPosition?.recordedAt ?? null,
    proximityCustomerId: proximity?.customerId ?? null,
    proximityCustomerName: proximity?.customerName ?? null,
    proximityDistanceMeters: proximity?.distanceMeters ?? null,
    hasSummary: bit(Boolean(summary)),
    routePointCount: summary?.routePointCount ?? null,
    distanceMeters: summary?.distanceMeters ?? null,
    customersNearby: summary?.customersNearby ?? null,
    customersArrived: summary?.customersArrived ?? null,
    customersDelivered: summary?.customersDelivered ?? null,
    customersNoSale: summary?.customersNoSale ?? null,
    salesCount: summary?.salesCount ?? null,
    totalSalesTTC: summary?.totalSalesTTC ?? null,
    theoreticalStockQuantity: summary?.theoreticalStockQuantity ?? null,
    stockCurrentQuantity: summary?.stockCurrentQuantity ?? null,
    actualStockQuantity: summary?.actualStockQuantity ?? null,
    discrepancyQuantity: summary?.discrepancyQuantity ?? null,
    totalAccessibleCustomers: summary?.totalAccessibleCustomers ?? null,
  };

  const result = await withTransaction(async (db) => {
    for (const table of [
      "cached_driver_tour",
      "cached_driver_tour_customers",
      "cached_driver_tour_route",
      "cached_driver_tour_stops",
    ]) {
      await db.run(`DELETE FROM ${table} WHERE organizationId = ? AND driverId = ?`, [organizationId, driverId], false);
    }

    const headerColumns = Object.keys(header);
    await insertRows(db, "cached_driver_tour", headerColumns, [headerColumns.map((column) => header[column])]);

    await insertRows(
      db,
      "cached_driver_tour_customers",
      [
        "organizationId", "driverId", "id", "position", "code", "name", "phone", "address", "city",
        "latitude", "longitude", "distanceMeters", "visitStatus", "lastEventAt", "noSaleReason",
      ],
      dto.customers.map((customer, position) => [
        organizationId, driverId, customer.id, position, customer.code, customer.name, customer.phone ?? null,
        customer.address, customer.city, customer.latitude ?? null, customer.longitude ?? null,
        customer.distanceMeters ?? null, customer.visitStatus, customer.lastEventAt ?? null,
        customer.noSaleReason ?? null,
      ]),
    );

    await insertRows(
      db,
      "cached_driver_tour_route",
      ["organizationId", "driverId", "seq", "latitude", "longitude", "accuracy", "speed", "heading", "recordedAt"],
      dto.route.map((point, seq) => [
        organizationId, driverId, seq, point.latitude, point.longitude, point.accuracy ?? null,
        point.speed ?? null, point.heading ?? null, point.recordedAt,
      ]),
    );

    await insertRows(
      db,
      "cached_driver_tour_stops",
      [
        "organizationId", "driverId", "id", "seq", "latitude", "longitude", "startedAt", "endedAt",
        "durationSeconds", "isActive",
      ],
      dto.stops.map((stop, seq) => [
        organizationId, driverId, stop.id, seq, stop.latitude, stop.longitude, stop.startedAt,
        stop.endedAt ?? null, stop.durationSeconds, bit(stop.isActive),
      ]),
    );
  });
  return result.ok;
}

export async function getCachedDriverTour(scope: Scope): Promise<CachedDriverTour | null> {
  const params = [scope.organizationId, scope.driverId];
  const [headers, customerRows, routeRows, stopRows] = await Promise.all([
    queryRows(`SELECT * FROM cached_driver_tour WHERE organizationId = ? AND driverId = ?`, params),
    queryRows(
      `SELECT * FROM cached_driver_tour_customers WHERE organizationId = ? AND driverId = ? ORDER BY position ASC`,
      params,
    ),
    queryRows(
      `SELECT * FROM cached_driver_tour_route WHERE organizationId = ? AND driverId = ? ORDER BY seq ASC`,
      params,
    ),
    queryRows(
      `SELECT * FROM cached_driver_tour_stops WHERE organizationId = ? AND driverId = ? ORDER BY seq ASC`,
      params,
    ),
  ]);
  const row = headers[0];
  if (!row) return null;

  const customers: DriverTourCustomerDto[] = customerRows.map((customer) => ({
    id: str(customer.id),
    code: str(customer.code),
    name: str(customer.name),
    phone: strOrNull(customer.phone),
    address: str(customer.address),
    city: str(customer.city),
    latitude: numOrNull(customer.latitude),
    longitude: numOrNull(customer.longitude),
    distanceMeters: numOrNull(customer.distanceMeters),
    visitStatus: str(customer.visitStatus) as DriverTourCustomerDto["visitStatus"],
    lastEventAt: strOrNull(customer.lastEventAt),
    noSaleReason: strOrNull(customer.noSaleReason),
  }));

  const route: DriverTourPositionDto[] = routeRows.map((point) => ({
    latitude: Number(point.latitude),
    longitude: Number(point.longitude),
    accuracy: numOrNull(point.accuracy),
    speed: numOrNull(point.speed),
    heading: numOrNull(point.heading),
    recordedAt: str(point.recordedAt),
  }));

  const stops: DriverTourStopDto[] = stopRows.map((stop) => ({
    id: str(stop.id),
    latitude: Number(stop.latitude),
    longitude: Number(stop.longitude),
    startedAt: str(stop.startedAt),
    endedAt: strOrNull(stop.endedAt),
    durationSeconds: Number(stop.durationSeconds),
    isActive: Number(stop.isActive) !== 0,
  }));

  const tour: TourDto | null =
    row.tourId === null || row.tourId === undefined
      ? null
      : {
          id: str(row.tourId),
          code: str(row.tourCode),
          date: str(row.tourDate),
          status: str(row.tourStatus),
          startedAt: strOrNull(row.startedAt),
          returnedAt: strOrNull(row.returnedAt),
          closedAt: strOrNull(row.closedAt),
          depot: { id: str(row.depotId), code: str(row.depotCode), name: str(row.depotName) },
          truck: {
            id: str(row.truckId),
            code: str(row.truckCode),
            registration: str(row.truckRegistration),
            status: str(row.truckStatus),
          },
          driver: {
            id: str(row.tourDriverId),
            employeeCode: str(row.driverEmployeeCode),
            name: str(row.driverName),
          },
          loading: parseJson<TourDto["loading"]>(row.loadingJson),
          stockSheet: parseJson<TourDto["stockSheet"]>(row.stockSheetJson),
          closure: parseJson<TourDto["closure"]>(row.closureJson),
          createdByUserName: str(row.createdByUserName),
          createdAt: str(row.tourCreatedAt),
          updatedAt: str(row.tourUpdatedAt),
        };

  const latestPosition: DriverTourPositionDto | null =
    row.latestRecordedAt === null || row.latestRecordedAt === undefined
      ? null
      : {
          latitude: Number(row.latestLatitude),
          longitude: Number(row.latestLongitude),
          accuracy: numOrNull(row.latestAccuracy),
          speed: numOrNull(row.latestSpeed),
          heading: numOrNull(row.latestHeading),
          recordedAt: str(row.latestRecordedAt),
        };

  const proximity: DriverTourProximityDto | null =
    row.proximityCustomerId === null || row.proximityCustomerId === undefined
      ? null
      : {
          customerId: str(row.proximityCustomerId),
          customerName: str(row.proximityCustomerName),
          distanceMeters: Number(row.proximityDistanceMeters),
        };

  const summary: DriverTourSummaryDto | null =
    Number(row.hasSummary) === 0
      ? null
      : {
          routePointCount: Number(row.routePointCount),
          distanceMeters: Number(row.distanceMeters),
          customersNearby: Number(row.customersNearby),
          customersArrived: Number(row.customersArrived),
          customersDelivered: Number(row.customersDelivered),
          customersNoSale: Number(row.customersNoSale),
          salesCount: Number(row.salesCount),
          totalSalesTTC: Number(row.totalSalesTTC),
          theoreticalStockQuantity: Number(row.theoreticalStockQuantity),
          stockCurrentQuantity: Number(row.stockCurrentQuantity),
          actualStockQuantity: numOrNull(row.actualStockQuantity),
          discrepancyQuantity: numOrNull(row.discrepancyQuantity),
          totalAccessibleCustomers: Number(row.totalAccessibleCustomers),
        };

  return {
    organizationId: scope.organizationId,
    driverId: scope.driverId,
    syncedAt: str(row.syncedAt),
    tour: {
      tour,
      message: str(row.message),
      startContext: parseJson<DriverTourStartContextDto>(row.startContextJson),
      canStart: Number(row.canStart) !== 0,
      canReturn: Number(row.canReturn) !== 0,
      customers,
      route,
      stops,
      latestPosition,
      proximity,
      summary,
    },
  };
}

// --- internal helpers -------------------------------------------------

async function queryRows(sql: string, params: unknown[]): Promise<Record<string, unknown>[]> {
  const rows = await withDatabase(async (db) => {
    const result = await db.query(sql, params);
    return result.values ?? [];
  });
  return rows ?? [];
}

function str(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function strOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function numOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function parseJson<T>(value: unknown): T | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
