import assert from "node:assert/strict";

import {
  isDriverTourFinished,
  resolveDriverTourEndPoint,
  resolveDriverTourFocusPoint,
  resolveDriverTourStartPoint,
} from "../lib/gps/tour-boundaries";
import type { DriverTourPositionDto } from "../types/operations-dto";

function main() {
  runScenario("depart = premier point fiable", () => {
    const points = createPoints([
      "2026-08-26T08:14:32.000Z",
      "2026-08-26T08:18:32.000Z",
    ]);

    assert.equal(resolveDriverTourStartPoint(points)?.recordedAt, points[0]?.recordedAt);
  });

  runScenario("aucune fin pendant une tournee active", () => {
    const points = createPoints([
      "2026-08-26T08:14:32.000Z",
      "2026-08-26T08:18:32.000Z",
    ]);

    assert.equal(
      resolveDriverTourEndPoint({
        points,
        status: "IN_PROGRESS",
        returnedAt: "2026-08-26T08:18:32.000Z",
      }),
      null,
    );
  });

  runScenario("fin = dernier point fiable avant returnedAt", () => {
    const points = createPoints([
      "2026-08-26T17:40:00.000Z",
      "2026-08-26T17:42:00.000Z",
      "2026-08-26T17:43:00.000Z",
    ]);

    const endPoint = resolveDriverTourEndPoint({
      points,
      status: "WAITING_FOR_CLOSURE",
      returnedAt: "2026-08-26T17:42:18.000Z",
    });

    assert.equal(endPoint?.recordedAt, points[1]?.recordedAt);
  });

  runScenario("sans returnedAt officiel, la fin tombe sur le dernier point", () => {
    const points = createPoints([
      "2026-08-26T17:40:00.000Z",
      "2026-08-26T17:42:00.000Z",
    ]);

    assert.equal(
      resolveDriverTourEndPoint({
        points,
        status: "WAITING_FOR_CLOSURE",
        returnedAt: null,
      })?.recordedAt,
      points[1]?.recordedAt,
    );
  });

  runScenario("aucun faux marqueur si tous les points sont apres returnedAt", () => {
    const points = createPoints([
      "2026-08-26T17:43:00.000Z",
      "2026-08-26T17:44:00.000Z",
    ]);

    assert.equal(
      resolveDriverTourEndPoint({
        points,
        status: "WAITING_FOR_CLOSURE",
        returnedAt: "2026-08-26T17:42:18.000Z",
      }),
      null,
    );
  });

  runScenario("le point de focus privilegie la fin sur une tournee terminee", () => {
    const points = createPoints([
      "2026-08-26T17:40:00.000Z",
      "2026-08-26T17:42:00.000Z",
      "2026-08-26T17:43:00.000Z",
    ]);

    assert.equal(
      resolveDriverTourFocusPoint({
        points,
        status: "CLOSED",
        returnedAt: "2026-08-26T17:42:18.000Z",
      })?.recordedAt,
      points[1]?.recordedAt,
    );
  });

  runScenario("les statuts finis sont bien identifies", () => {
    assert.equal(isDriverTourFinished("WAITING_FOR_CLOSURE"), true);
    assert.equal(isDriverTourFinished("CLOSED"), true);
    assert.equal(isDriverTourFinished("IN_PROGRESS"), false);
  });

  console.log("Tous les scenarios driver tour boundaries sont passes.");
}

function runScenario(name: string, fn: () => void) {
  fn();
  console.log(`OK - ${name}`);
}

function createPoints(recordedAts: string[]): DriverTourPositionDto[] {
  return recordedAts.map((recordedAt, index) => ({
    latitude: 33.5731 + index * 0.0001,
    longitude: -7.5898 - index * 0.0001,
    accuracy: 8,
    speed: 0,
    heading: null,
    recordedAt,
  }));
}

main();
