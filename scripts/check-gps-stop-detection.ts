import assert from "node:assert/strict";

import { GPS_GAP_MS } from "../lib/gps/gps-config";
import { detectGpsStops } from "../lib/gps/gps-stop-detection";
import type { GpsPointLike } from "../lib/gps/gps-utils";

type ScenarioPointOptions = {
  accuracy?: number | null;
  speed?: number | null;
  eastMeters?: number;
  northMeters?: number;
};

const BASE_LATITUDE = 33.5731;
const BASE_LONGITUDE = -7.5898;
const METERS_PER_DEGREE_LATITUDE = 111_320;

function main() {
  runScenario("telephone pose pendant 5 minutes", () => {
    const points = createScenarioFromOffsets(
      [0, 6, -9, 11, 4, -7],
      60,
      { speed: 0, accuracy: 8 },
    );
    const nowMs = pointTime(points[points.length - 1]!) + 1_000;
    const stops = detectGpsStops(points, { now: nowMs });

    assert.equal(stops.length, 1);
    assert.equal(stops[0]?.isActive, true);
    assert.equal(stops[0]?.durationSeconds, 301);
  });

  runScenario("derive progressive jusqu'a 29 metres", () => {
    const points = createScenarioFromOffsets(
      [0, 5, 12, 18, 24, 29],
      60,
      { speed: 0, accuracy: 8 },
    );
    const nowMs = pointTime(points[points.length - 1]!) + 1_000;
    const stops = detectGpsStops(points, { now: nowMs });

    assert.equal(stops.length, 1);
    assert.equal(stops[0]?.isActive, true);
  });

  runScenario("sortie temporaire unique a 52 metres", () => {
    const points = createScenarioFromOffsets(
      [0, 15, 18, 52, 12, 17],
      60,
      { speed: 0, accuracy: 8 },
    );
    const nowMs = pointTime(points[points.length - 1]!) + 1_000;
    const stops = detectGpsStops(points, { now: nowMs });

    assert.equal(stops.length, 1);
    assert.equal(stops[0]?.isActive, true);
    assert.equal(stops[0]?.endedAt, null);
  });

  runScenario("vraie sortie confirmee sur deux points fiables", () => {
    const points = createScenarioFromOffsets(
      [0, 15, 10, 12, 15, 65, 87, 110],
      60,
      { speed: 0, accuracy: 8 },
      {
        5: { speed: 8 },
        6: { speed: 8 },
        7: { speed: 8 },
      },
    );
    const nowMs = pointTime(points[points.length - 1]!) + 1_000;
    const stops = detectGpsStops(points, { now: nowMs });

    assert.equal(stops.length, 1);
    assert.equal(stops[0]?.isActive, false);
    assert.equal(stops[0]?.endedAt, points[5]?.recordedAt ?? null);
  });

  runScenario("zone incertaine entre 30 et 45 metres", () => {
    const points = createScenarioFromOffsets(
      [0, 25, 34, 39, 32, 24],
      60,
      { speed: 0, accuracy: 8 },
    );
    const nowMs = pointTime(points[points.length - 1]!) + 1_000;
    const stops = detectGpsStops(points, { now: nowMs });

    assert.equal(stops.length, 1);
    assert.equal(stops[0]?.isActive, true);
  });

  runScenario("mauvaise accuracy ne termine pas la pause", () => {
    const points = createScenarioFromOffsets(
      [0, 8, 11, 70, 9, 6],
      60,
      { speed: 0, accuracy: 8 },
      {
        3: { accuracy: 100 },
      },
    );
    const nowMs = pointTime(points[points.length - 1]!) + 1_000;
    const stops = detectGpsStops(points, { now: nowMs });

    assert.equal(stops.length, 1);
    assert.equal(stops[0]?.isActive, true);
    assert.equal(stops[0]?.endedAt, null);
  });

  runScenario("arret inferieur a 2 minutes", () => {
    const points = createScenarioFromOffsets(
      [0, 8, 12, 9],
      30,
      { speed: 0, accuracy: 8 },
    );
    const nowMs = pointTime(points[points.length - 1]!) + 1_000;
    const stops = detectGpsStops(points, { now: nowMs });

    assert.equal(stops.length, 0);
  });

  runScenario("arret de 10 minutes reste un seul stop", () => {
    const points = createScenarioFromOffsets(
      [0, 5, 9, 12, 7, 10, 8, 14, 11, 6, 9],
      60,
      { speed: 0, accuracy: 8 },
    );
    const nowMs = pointTime(points[points.length - 1]!) + 1_000;
    const stops = detectGpsStops(points, { now: nowMs });

    assert.equal(stops.length, 1);
    assert.equal(stops[0]?.durationSeconds, 601);
  });

  runScenario("gap GPS coupe bien les sequences", () => {
    const points = [
      ...createScenarioFromOffsets([0, 7, 10, 6], 60, { speed: 0, accuracy: 8 }),
      ...createScenarioFromOffsets(
        [0, 6, 8, 5],
        60,
        { speed: 0, accuracy: 8 },
        undefined,
        pointTime(createScenarioFromOffsets([0], 60, { speed: 0, accuracy: 8 })[0]!) + GPS_GAP_MS + 60_000 + 180_000,
      ),
    ];
    const nowMs = pointTime(points[points.length - 1]!) + 1_000;
    const stops = detectGpsStops(points, { now: nowMs });

    assert.equal(stops.length, 2);
    assert.equal(stops[0]?.durationSeconds, 180);
    assert.equal(stops[1]?.durationSeconds, 181);
  });

  runScenario("premier point mediocre ne devient pas startedAt officiel", () => {
    const points = createScenarioFromOffsets(
      [0, 6, 4, 8, 7],
      60,
      { speed: 0, accuracy: 8 },
      {
        0: { accuracy: 80 },
      },
    );
    const nowMs = pointTime(points[points.length - 1]!) + 1_000;
    const stops = detectGpsStops(points, { now: nowMs });

    assert.equal(stops.length, 1);
    assert.equal(stops[0]?.startedAt, points[1]?.recordedAt);
  });

  console.log("Tous les scenarios GPS stop detection sont passes.");
}

function runScenario(name: string, fn: () => void) {
  fn();
  console.log(`OK - ${name}`);
}

function createScenarioFromOffsets(
  eastOffsetsMeters: number[],
  intervalSeconds: number,
  defaults: ScenarioPointOptions,
  overrides?: Record<number, ScenarioPointOptions>,
  startMs = Date.UTC(2026, 7, 26, 12, 0, 0),
) {
  return eastOffsetsMeters.map((eastMeters, index) =>
    createPoint({
      eastMeters,
      northMeters: 0,
      accuracy: defaults.accuracy ?? null,
      speed: defaults.speed ?? null,
      recordedAtMs: startMs + index * intervalSeconds * 1_000,
      ...(overrides?.[index] ?? {}),
    }),
  );
}

function createPoint(options: ScenarioPointOptions & { recordedAtMs: number }): GpsPointLike {
  const northMeters = options.northMeters ?? 0;
  const eastMeters = options.eastMeters ?? 0;
  const latitude = BASE_LATITUDE + northMeters / METERS_PER_DEGREE_LATITUDE;
  const metersPerDegreeLongitude =
    METERS_PER_DEGREE_LATITUDE * Math.cos((BASE_LATITUDE * Math.PI) / 180);
  const longitude = BASE_LONGITUDE + eastMeters / metersPerDegreeLongitude;

  return {
    latitude,
    longitude,
    accuracy: options.accuracy ?? null,
    speed: options.speed ?? null,
    recordedAt: new Date(options.recordedAtMs).toISOString(),
  };
}

function pointTime(point: Pick<GpsPointLike, "recordedAt">) {
  return Date.parse(point.recordedAt);
}

main();
