/**
 * GPS source abstraction.
 *
 * Today COMDIS reads positions from the browser's Geolocation API
 * (BrowserGpsProvider). The rest of the app (use-driver-geolocation hook,
 * map components) only talks to the GpsProvider interface below, so a
 * future external source (e.g. a Traccar device feed) could be plugged in
 * as a TraccarGpsProvider without touching map/route/proximity logic.
 */

export type GpsProviderPosition = {
  latitude: number;
  longitude: number;
  /** Meters, or null if the source doesn't report one. */
  accuracy: number | null;
  /** m/s, or null if unavailable. */
  speed: number | null;
  /** Degrees, or null if unavailable. */
  heading: number | null;
  /** Epoch ms — when the position was actually captured by the device. */
  timestamp: number;
};

export type GpsProviderErrorKind = "DENIED" | "UNAVAILABLE" | "TIMEOUT";

export type GpsProviderError = {
  kind: GpsProviderErrorKind;
  message: string;
};

export type GpsWatchHandle = {
  clear: () => void;
};

export type GpsPermissionState = PermissionState | "unsupported";

export interface GpsProvider {
  isSupported(): boolean;
  queryPermissionState(): Promise<GpsPermissionState>;
  /** One-shot fresh fix (maximumAge is always 0 — never returns a cached browser position). */
  getCurrentPosition(options: { timeoutMs: number }): Promise<GpsProviderPosition>;
  /** Continuous updates. Caller MUST call the returned handle's clear() to stop it. */
  watchPosition(
    onPosition: (position: GpsProviderPosition) => void,
    onError: (error: GpsProviderError) => void,
    options: { maximumAgeMs: number; timeoutMs: number },
  ): GpsWatchHandle;
}

function toProviderPosition(position: GeolocationPosition): GpsProviderPosition {
  const { coords, timestamp } = position;
  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracy: typeof coords.accuracy === "number" ? coords.accuracy : null,
    speed: typeof coords.speed === "number" && coords.speed >= 0 ? coords.speed : null,
    heading: typeof coords.heading === "number" && coords.heading >= 0 ? coords.heading : null,
    timestamp,
  };
}

function toProviderError(error: GeolocationPositionError): GpsProviderError {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return {
        kind: "DENIED",
        message:
          "Autorisez l'acces a votre position dans le navigateur. Cliquez sur l'icone a gauche de l'adresse du site et autorisez la localisation.",
      };
    case error.POSITION_UNAVAILABLE:
      return {
        kind: "UNAVAILABLE",
        message: "Votre appareil n'arrive pas a determiner votre position.",
      };
    case error.TIMEOUT:
      return {
        kind: "TIMEOUT",
        message: "La recherche GPS a pris trop de temps. Reessayez.",
      };
    default:
      return {
        kind: "UNAVAILABLE",
        message: "Le suivi GPS est indisponible pour le moment.",
      };
  }
}

/**
 * Geolocation requires a secure context (HTTPS, or localhost) in modern
 * browsers. `navigator.geolocation` can still exist on an insecure origin
 * (e.g. a plain-HTTP LAN IP on a phone) but every call fails — checking this
 * up front lets the UI show the real reason instead of a generic denial.
 */
export function isSecureGeolocationContext(): boolean {
  return typeof window === "undefined" || window.isSecureContext !== false;
}

export class BrowserGpsProvider implements GpsProvider {
  isSupported() {
    return typeof navigator !== "undefined" && "geolocation" in navigator;
  }

  async queryPermissionState(): Promise<GpsPermissionState> {
    if (typeof navigator === "undefined" || !("permissions" in navigator)) {
      return "unsupported";
    }

    try {
      const permission = await navigator.permissions.query({
        name: "geolocation" as PermissionName,
      });
      return permission.state;
    } catch {
      return "unsupported";
    }
  }

  getCurrentPosition({ timeoutMs }: { timeoutMs: number }): Promise<GpsProviderPosition> {
    return new Promise((resolve, reject) => {
      if (!this.isSupported()) {
        reject({ kind: "UNAVAILABLE", message: "La geolocalisation n'est pas disponible sur cet appareil." } satisfies GpsProviderError);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => resolve(toProviderPosition(position)),
        (error) => reject(toProviderError(error)),
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: timeoutMs,
        },
      );
    });
  }

  watchPosition(
    onPosition: (position: GpsProviderPosition) => void,
    onError: (error: GpsProviderError) => void,
    { maximumAgeMs, timeoutMs }: { maximumAgeMs: number; timeoutMs: number },
  ): GpsWatchHandle {
    if (!this.isSupported()) {
      onError({ kind: "UNAVAILABLE", message: "La geolocalisation n'est pas disponible sur cet appareil." });
      return { clear: () => {} };
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => onPosition(toProviderPosition(position)),
      (error) => onError(toProviderError(error)),
      {
        enableHighAccuracy: true,
        maximumAge: maximumAgeMs,
        timeout: timeoutMs,
      },
    );

    return {
      clear: () => navigator.geolocation.clearWatch(watchId),
    };
  }
}

export const browserGpsProvider = new BrowserGpsProvider();
