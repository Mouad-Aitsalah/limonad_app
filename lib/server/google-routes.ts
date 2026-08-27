import "server-only";

import { z } from "zod";

import { isGpsPointReliable } from "@/lib/gps/gps-utils";
import { prisma } from "@/lib/prisma";
import { requireSessionUser } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { requireActiveTourForDriver } from "@/lib/server/tours";
import type { GoogleRouteDto, MapCoordinate } from "@/types/maps";

const routeRequestSchema = z.object({
  destination: z.object({
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
  }),
});

type GoogleRoutesResponse = {
  routes?: Array<{
    distanceMeters?: number;
    duration?: string;
    polyline?: {
      geoJsonLinestring?: {
        coordinates?: Array<[number, number]>;
      };
    };
  }>;
  error?: {
    message?: string;
  };
};

export async function getDrivingRouteForCurrentDriver(
  input: unknown,
): Promise<GoogleRouteDto> {
  const payload = routeRequestSchema.parse(input);
  const user = await requireSessionUser(["driver"]);

  if (!user.driverId) {
    throw new OperationsServiceError("Profil chauffeur introuvable.", 403);
  }

  const tour = await requireActiveTourForDriver(user.driverId);
  const origin = await getLatestReliableTourPosition(tour.id);

  return computeGoogleDrivingRoute(origin, payload.destination);
}

async function getLatestReliableTourPosition(tourId: string): Promise<MapCoordinate> {
  const latestPing = await prisma.tourLocationPing.findFirst({
    where: { tourId },
    orderBy: { recordedAt: "desc" },
    select: {
      latitude: true,
      longitude: true,
      accuracy: true,
      recordedAt: true,
    },
  });

  const latestPoint = latestPing
    ? {
        latitude: latestPing.latitude.toNumber(),
        longitude: latestPing.longitude.toNumber(),
        accuracy: latestPing.accuracy?.toNumber() ?? null,
        recordedAt: latestPing.recordedAt.toISOString(),
      }
    : null;

  if (!latestPoint || !isGpsPointReliable(latestPoint)) {
    throw new OperationsServiceError(
      "Position GPS actuelle indisponible pour calculer l'itineraire.",
      409,
    );
  }

  return {
    latitude: latestPoint.latitude,
    longitude: latestPoint.longitude,
  };
}

async function computeGoogleDrivingRoute(
  origin: MapCoordinate,
  destination: MapCoordinate,
): Promise<GoogleRouteDto> {
  const apiKey = process.env.GOOGLE_MAPS_ROUTES_API_KEY;
  if (!apiKey) {
    throw new OperationsServiceError(
      "Configurez GOOGLE_MAPS_ROUTES_API_KEY pour calculer les itineraires.",
      503,
    );
  }

  const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "routes.duration,routes.distanceMeters,routes.polyline.geoJsonLinestring",
    },
    body: JSON.stringify({
      origin: {
        location: {
          latLng: {
            latitude: origin.latitude,
            longitude: origin.longitude,
          },
        },
      },
      destination: {
        location: {
          latLng: {
            latitude: destination.latitude,
            longitude: destination.longitude,
          },
        },
      },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_UNAWARE",
      polylineQuality: "HIGH_QUALITY",
      polylineEncoding: "GEO_JSON_LINESTRING",
    }),
  });

  const data = (await response.json()) as GoogleRoutesResponse;

  if (!response.ok) {
    throw new OperationsServiceError(
      data.error?.message ?? "Impossible de calculer l'itineraire Google Maps.",
      response.status,
    );
  }

  const route = data.routes?.[0];
  const coordinates = route?.polyline?.geoJsonLinestring?.coordinates ?? [];
  if (!route || coordinates.length === 0) {
    throw new OperationsServiceError("Aucun itineraire disponible pour ce client.", 404);
  }

  return {
    distanceMeters: route.distanceMeters ?? 0,
    durationSeconds: parseGoogleDuration(route.duration),
    polyline: coordinates.map(([longitude, latitude]) => ({ latitude, longitude })),
  };
}

function parseGoogleDuration(value: string | undefined) {
  if (!value?.endsWith("s")) {
    return null;
  }

  const seconds = Number(value.slice(0, -1));
  return Number.isFinite(seconds) ? seconds : null;
}
