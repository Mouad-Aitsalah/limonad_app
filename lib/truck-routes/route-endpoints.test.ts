import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { TruckRouteDto, TruckRoutePointDto } from "@/types/truck-routes";

import { isRouteFinished, resolveRouteEndpoints } from "./route-endpoints";
import {
  formatCommercialStopNumber,
  formatRouteDateTime,
  formatRouteDay,
  formatRouteTime,
} from "./route-format";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const point = (id: string, recordedAt: string): TruckRoutePointDto => ({
  id,
  latitude: 33.5,
  longitude: -7.6,
  accuracy: null,
  speed: null,
  heading: null,
  recordedAt,
});

function route(
  status: TruckRouteDto["tour"]["status"],
  options: { points?: TruckRoutePointDto[]; startedAt?: string | null; returnedAt?: string | null; hasReturned?: boolean },
): Pick<TruckRouteDto, "tour" | "points"> {
  return {
    points: options.points ?? [],
    tour: {
      id: "t1",
      code: "TOUR-20261005-001",
      date: "2026-10-05T00:00:00.000Z",
      status,
      startedAt: options.startedAt ?? null,
      returnedAt: options.returnedAt ?? null,
      closedAt: null,
      hasReturned: options.hasReturned ?? false,
    },
  };
}

const GPS = [point("p1", "2026-10-05T08:47:00.000Z"), point("p2", "2026-10-05T12:00:00.000Z"), point("p3", "2026-10-05T19:39:00.000Z")];

// ---- formats -----------------------------------------------------------------------------------------

test("format '05 oct. 2026 · 09:45' in the Casablanca business time zone, display only", () => {
  assert.equal(formatRouteDateTime("2026-10-05T08:45:00.000Z"), "05 oct. 2026 · 09:45");
  assert.equal(formatRouteDateTime("2026-10-05T19:39:00.000Z"), "05 oct. 2026 · 20:39");
  assert.equal(formatRouteTime("2026-10-05T08:52:00.000Z"), "09:52");
  assert.equal(formatRouteDay("2026-10-05T00:00:00.000Z"), "05 oct. 2026", "a calendar date is never shifted");
  assert.equal(formatRouteDateTime(null), "-");
  assert.equal(formatRouteDateTime("not-a-date"), "-");
  assert.equal(formatRouteTime(undefined), "-");
  assert.equal(formatCommercialStopNumber(1), "①");
  assert.equal(formatCommercialStopNumber(20), "⑳");
  assert.equal(formatCommercialStopNumber(21), "(21)");
});

// ---- departure / arrival / last position --------------------------------------------------------------

test("a finished tour: DÉPART at the first GPS point (startedAt), ARRIVÉE at the last one (returnedAt)", () => {
  const endpoints = resolveRouteEndpoints(
    route("CLOSED", {
      points: GPS,
      startedAt: "2026-10-05T08:45:00.000Z",
      returnedAt: "2026-10-05T19:39:00.000Z",
      hasReturned: true,
    }),
  );
  assert.equal(endpoints.isFinished, true);
  assert.equal(endpoints.start.point?.id, "p1", "the same first point the map always used");
  assert.equal(endpoints.start.at, "2026-10-05T08:45:00.000Z", "the tour's startedAt, not the GPS time");
  assert.deepEqual(endpoints.end && { kind: endpoints.end.kind, point: endpoints.end.point.id, at: endpoints.end.at }, {
    kind: "ARRIVAL",
    point: "p3",
    at: "2026-10-05T19:39:00.000Z",
  });
  assert.equal(endpoints.arrivalAt, "2026-10-05T19:39:00.000Z");
  assert.equal(endpoints.lastPosition, null);
});

test("a tour IN PROGRESS never shows ARRIVÉE: the last GPS point is the LAST POSITION, at the point's time", () => {
  // even with a returnedAt filled by the GPS fallback (route.tour.returnedAt) and even if hasReturned were set
  for (const hasReturned of [false, true]) {
    const endpoints = resolveRouteEndpoints(
      route("IN_PROGRESS", {
        points: GPS,
        startedAt: "2026-10-05T08:45:00.000Z",
        returnedAt: "2026-10-05T19:39:00.000Z",
        hasReturned,
      }),
    );
    assert.equal(endpoints.isFinished, false);
    assert.equal(endpoints.end?.kind, "LAST_POSITION");
    assert.equal(endpoints.end?.at, "2026-10-05T19:39:00.000Z");
    assert.equal(endpoints.arrivalAt, null, "no arrival time for a tour that is not over");
    assert.equal(endpoints.lastPosition?.id, "p3");
  }
});

test("a tour waiting for closure (returned) is finished, even without returnedAt recorded (existing rule)", () => {
  assert.equal(isRouteFinished({ status: "WAITING_FOR_CLOSURE", hasReturned: false }), true);
  assert.equal(isRouteFinished({ status: "CLOSED", hasReturned: false }), true);
  // a CLOSED tour without returnedAt: arrival at the existing GPS fallback time
  const endpoints = resolveRouteEndpoints(route("CLOSED", { points: GPS, returnedAt: "2026-10-05T19:39:00.000Z" }));
  assert.equal(endpoints.end?.kind, "ARRIVAL");
});

test("an interrupted / cancelled tour without returnedAt shows a LAST POSITION, never an invented arrival", () => {
  for (const status of ["INTERRUPTED", "CANCELLED"] as const) {
    assert.equal(isRouteFinished({ status, hasReturned: false }), false);
    assert.equal(resolveRouteEndpoints(route(status, { points: GPS })).end?.kind, "LAST_POSITION");
    assert.equal(isRouteFinished({ status, hasReturned: true }), true, `${status} with a real returnedAt`);
  }
});

test("no GPS: no marker at all, the panel times stay available", () => {
  const endpoints = resolveRouteEndpoints(
    route("CLOSED", { startedAt: "2026-10-05T08:45:00.000Z", returnedAt: "2026-10-05T19:39:00.000Z", hasReturned: true }),
  );
  assert.equal(endpoints.start.point, null);
  assert.equal(endpoints.end, null);
  assert.equal(endpoints.start.at, "2026-10-05T08:45:00.000Z");
  assert.equal(endpoints.arrivalAt, "2026-10-05T19:39:00.000Z");
});

test("a single GPS point: DÉPART only, no end marker (same rule as before)", () => {
  const endpoints = resolveRouteEndpoints(route("IN_PROGRESS", { points: [GPS[0]] }));
  assert.equal(endpoints.start.point?.id, "p1");
  assert.equal(endpoints.end, null);
  assert.equal(endpoints.lastPosition?.id, "p1", "the panel can still show the last known position");
});

// ---- the map keeps the GPS route untouched ----------------------------------------------------------

test("trajets-map: same polyline / bounds code, new markers only, legacy google.maps.Marker kept", () => {
  const map = read("../../components/trajets/trajets-map.tsx");
  assert.match(map, /routePolylinesRef\.current = splitGpsRouteIntoSegments\(route\.points\)/);
  assert.match(map, /strokeColor: "#0f7a5d",/);
  assert.match(map, /fitRouteBounds\(googleRef\.current, mapRef\.current, route, visitMarkers\);/);
  assert.equal(/AdvancedMarkerElement|importLibrary\("marker"\)|mapId/.test(map), false);
  assert.match(map, /resolveRouteEndpoints\(route\)/);
  // numbered commercial stops: bigger circle, white bold number, above the others
  assert.match(map, /text: String\(stopNumber\),\s*\n\s*color: "#ffffff",/);
  assert.match(map, /fontWeight: "700",/);
  assert.match(map, /zIndex: COMMERCIAL_STOP_Z_INDEX - Math\.min\(stopNumber, 999\)/);
  assert.match(map, /START: \{ label: "DÉPART"/);
  assert.match(map, /ARRIVAL: \{ label: "ARRIVÉE"/);
  assert.match(map, /LAST_POSITION: \{ label: "DERNIÈRE POSITION"/);
});

test("the live tab and the GPS helpers are not touched by this change", () => {
  // the live map still has its own AdvancedMarkerElement markers and no commercial numbering
  const live = read("../../components/trajets/live-fleet-map.tsx");
  assert.match(live, /AdvancedMarkerElement/);
  assert.equal(/commercialStopNumber|resolveRouteEndpoints/.test(live), false);
});
