import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { REAL_SALE_STATUSES } from "@/lib/forecasting/product-daily-sales";

import {
  computeCommercialStops,
  firstSalesByCustomer,
  isRealSaleStatus,
  type CommercialSaleInput,
} from "./commercial-stops";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

let sequence = 0;
/** A sale at "HH:MM" on 2026-10-05 (UTC), status PAID unless told otherwise. */
function sale(customerId: string | null, time: string, overrides: Partial<CommercialSaleInput> = {}): CommercialSaleInput {
  sequence += 1;
  const at = `2026-10-05T${time}:00.000Z`;
  return {
    id: `sale-${String(sequence).padStart(4, "0")}`,
    customerId,
    status: "PAID",
    soldAt: null,
    createdAt: at,
    tourId: "tour-1",
    ...overrides,
  };
}

/** customerId -> number, in number order. */
function numbers(stops: ReturnType<typeof computeCommercialStops>) {
  return Object.fromEntries(
    [...stops.values()]
      .sort((a, b) => a.commercialStopNumber - b.commercialStopNumber)
      .map((stop) => [stop.customerId, stop.commercialStopNumber]),
  );
}

// 1
test("three customers with a sale -> 1, 2, 3 in the order of their sales", () => {
  const stops = computeCommercialStops([sale("A", "09:00"), sale("B", "10:00"), sale("C", "11:00")]);
  assert.deepEqual(numbers(stops), { A: 1, B: 2, C: 3 });
  assert.equal(stops.get("A")?.firstSaleAt, "2026-10-05T09:00:00.000Z");
});

// 2
test("a customer without a sale never consumes a number (A no sale, B and C sales -> B=1, C=2)", () => {
  // A only exists as a GPS visit: it has no sale, so it is simply absent from the sales.
  const stops = computeCommercialStops([sale("B", "10:00"), sale("C", "11:00")]);
  assert.deepEqual(numbers(stops), { B: 1, C: 2 });
  assert.equal(stops.has("A"), false);
});

// 3
test("several sales at the same customer: ONE number, from the first sale (A 09:00, B 10:00, A 11:00, C 12:00)", () => {
  const stops = computeCommercialStops([sale("A", "09:00"), sale("B", "10:00"), sale("A", "11:00"), sale("C", "12:00")]);
  assert.deepEqual(numbers(stops), { A: 1, B: 2, C: 3 });
  assert.equal(stops.size, 3, "3 distinct customers, not 4 sales");
  assert.equal(stops.get("A")?.firstSaleAt, "2026-10-05T09:00:00.000Z");
});

// 4
test("the input order does not matter: always chronological by first sale", () => {
  const ordered = [sale("A", "09:00"), sale("B", "10:00"), sale("A", "11:00"), sale("C", "12:00"), sale("D", "08:30")];
  const expected = { D: 1, A: 2, B: 3, C: 4 };
  assert.deepEqual(numbers(computeCommercialStops(ordered)), expected);
  for (const shuffled of [
    [...ordered].reverse(),
    [ordered[2], ordered[4], ordered[0], ordered[3], ordered[1]],
    [ordered[3], ordered[1], ordered[4], ordered[2], ordered[0]],
  ]) {
    assert.deepEqual(numbers(computeCommercialStops(shuffled)), expected);
  }
});

// 5
test("no sale -> no number", () => {
  assert.equal(computeCommercialStops([]).size, 0);
});

// 6
test("a CANCELLED sale is ignored", () => {
  const stops = computeCommercialStops([
    sale("A", "09:00", { status: "CANCELLED" }),
    sale("B", "10:00"),
    sale("A", "11:00", { status: "CANCELLED" }),
  ]);
  assert.deepEqual(numbers(stops), { B: 1 });
});

// 7
test("a DRAFT sale (prepared, not collected) is ignored - a later real sale of the same customer counts", () => {
  const stops = computeCommercialStops([
    sale("A", "09:00", { status: "DRAFT" }),
    sale("B", "10:00", { status: "DRAFT" }),
    sale("C", "10:30"),
    sale("A", "11:00", { status: "VALIDATED" }),
  ]);
  assert.deepEqual(numbers(stops), { C: 1, A: 2 });
  assert.equal(stops.get("A")?.firstSaleAt, "2026-10-05T11:00:00.000Z", "the DRAFT at 09:00 is not the first real sale");
});

test("every status of the ERP-wide REAL_SALE_STATUSES counts, DRAFT and CANCELLED never", () => {
  assert.deepEqual([...REAL_SALE_STATUSES], ["VALIDATED", "PARTIALLY_PAID", "PAID", "CREDIT", "CREDIT_NOTED"]);
  for (const status of REAL_SALE_STATUSES) assert.equal(isRealSaleStatus(status), true, status);
  assert.equal(isRealSaleStatus("DRAFT"), false);
  assert.equal(isRealSaleStatus("CANCELLED"), false);
  const stops = computeCommercialStops(REAL_SALE_STATUSES.map((status, i) => sale(`C${i}`, `0${i + 1}:00`, { status })));
  assert.equal(stops.size, REAL_SALE_STATUSES.length, "CREDIT_NOTED included, like the BI");
});

// 8
test("an offline sale synced later: its real moment (soldAt) is used, not the sync time (createdAt)", () => {
  const stops = computeCommercialStops([
    // made at 09:10 offline, synced at 12:00
    sale("A", "12:00", { soldAt: "2026-10-05T09:10:00.000Z" }),
    sale("B", "10:00"),
  ]);
  assert.deepEqual(numbers(stops), { A: 1, B: 2 });
  assert.equal(stops.get("A")?.firstSaleAt, "2026-10-05T09:10:00.000Z");
});

// 9
test("two sales at exactly the same moment: deterministic order by createdAt, then by id", () => {
  const sameMoment = "2026-10-05T10:00:00.000Z";
  // same soldAt, different createdAt -> createdAt decides
  const byCreatedAt = [
    sale("X", "10:05", { soldAt: sameMoment }),
    sale("Y", "10:01", { soldAt: sameMoment }),
  ];
  assert.deepEqual(numbers(computeCommercialStops(byCreatedAt)), { Y: 1, X: 2 });
  assert.deepEqual(numbers(computeCommercialStops([...byCreatedAt].reverse())), { Y: 1, X: 2 });

  // same moment AND same createdAt -> id decides
  const byId = [
    { id: "sale-b", customerId: "P", status: "PAID", soldAt: null, createdAt: sameMoment },
    { id: "sale-a", customerId: "Q", status: "PAID", soldAt: null, createdAt: sameMoment },
  ];
  for (let run = 0; run < 5; run += 1) {
    assert.deepEqual(numbers(computeCommercialStops(run % 2 ? byId : [...byId].reverse())), { Q: 1, P: 2 });
  }
});

// 10
test("a sale without customerId gets no number and does not shift the others", () => {
  const stops = computeCommercialStops([sale(null, "09:00"), sale("A", "10:00"), sale(null, "10:30"), sale("B", "11:00")]);
  assert.deepEqual(numbers(stops), { A: 1, B: 2 });
  assert.equal([...stops.keys()].includes(null as unknown as string), false);
});

// 11
test("a customer with a sale but no coordinates still gets its number (the GPS plays no role)", () => {
  // the sales carry no coordinates at all: the numbering only depends on the sales
  const stops = computeCommercialStops([sale("A", "09:00"), sale("B-without-gps", "10:00"), sale("C", "11:00")]);
  assert.deepEqual(numbers(stops), { A: 1, "B-without-gps": 2, C: 3 });
});

// 12
test("several tours / organisations: no leak - only the sales of the tour are numbered", () => {
  const mixed = [
    sale("A", "09:00", { tourId: "tour-1" }),
    sale("Z", "08:00", { tourId: "tour-2" }), // another tour (another organisation): earlier, must not count
    sale("B", "10:00", { tourId: "tour-1" }),
    sale("A2", "07:00", { tourId: null }), // not linked to any tour
  ];
  assert.deepEqual(numbers(computeCommercialStops(mixed, { tourId: "tour-1" })), { A: 1, B: 2 });
  assert.deepEqual(numbers(computeCommercialStops(mixed, { tourId: "tour-2" })), { Z: 1 });
});

test("the number is per DISTINCT customer: A 3 sales, B 2, C 1 -> 3 stores with a sale, not 6", () => {
  const stops = computeCommercialStops([
    sale("A", "09:00"),
    sale("A", "09:10"),
    sale("B", "09:20"),
    sale("A", "09:30"),
    sale("C", "09:40"),
    sale("B", "09:50"),
  ]);
  assert.equal(stops.size, 3);
});

test("firstSalesByCustomer with another filter keeps the same ordering rule", () => {
  const all = [sale("A", "09:00", { status: "DRAFT" }), sale("B", "08:00"), sale("A", "10:00")];
  assert.deepEqual(
    firstSalesByCustomer(all, () => true).map((first) => [first.customerId, first.firstSaleAt]),
    [
      ["B", "2026-10-05T08:00:00.000Z"],
      ["A", "2026-10-05T09:00:00.000Z"],
    ],
  );
});

test("invalid dates are ignored, never crash and never get a number", () => {
  const stops = computeCommercialStops([
    { id: "x", customerId: "A", status: "PAID", soldAt: null, createdAt: "not-a-date" },
    sale("B", "10:00"),
  ]);
  assert.deepEqual(numbers(stops), { B: 1 });
});

// ---- the server uses it on the sales already loaded, without any per-customer query -------------------------

test("getTourGpsHistory: one tour query + the existing batched customer query, numbering in memory", () => {
  const source = read("../server/truck-routes.ts");
  const fn = source.slice(source.indexOf("export async function getTourGpsHistory"), source.indexOf("export function getTruckRouteStatusLabel"));
  assert.equal((fn.match(/await prisma\./g) ?? []).length, 2, "tour.findFirst + the existing customer.findMany");
  assert.match(fn, /computeCommercialStops\(tour\.sales, \{ tourId: tour\.id \}\)/);
  // the sales select carries what the rule needs, in an explicit order
  assert.match(fn, /soldAt: true,\s*\n\s*status: true,\s*\n\s*tourId: true,/);
  assert.match(fn, /orderBy: \[\{ createdAt: "asc" \}, \{ id: "asc" \}\]/);
  // the former row-order-dependent firstSaleAt is gone
  assert.equal(/current\.firstSaleAt \?\?/.test(fn), false);
  // DTO
  assert.match(fn, /commercialStopNumber: commercialStop\?\.commercialStopNumber \?\? null,/);
  assert.match(fn, /firstSaleAt: commercialStop\?\.firstSaleAt \?\? null,/);
  assert.match(fn, /customersWithSaleCount: commercialStops\.size,/);
  assert.match(fn, /hasReturned: tour\.returnedAt !== null,/);
  // unchanged: GPS, distance, duration, sales totals
  assert.match(fn, /const sanitizedPoints = sanitizeGpsPoints\(rawPoints\);/);
  assert.match(fn, /calculateRouteDistanceMeters\(sanitizedPoints\) \/ 1000/);
  assert.match(fn, /salesCount: tour\.sales\.length,/);
  assert.match(fn, /where: \{ status: \{ not: "CANCELLED" \} \}/);
});
