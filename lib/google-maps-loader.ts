"use client";

let googleMapsPromise: Promise<GoogleMapsApi> | null = null;

// ÉTAPE 28D - never wait forever on a script that will not come (a captive
// portal, a half-dead connection): the callers show their own "map
// unavailable" state instead of a permanent spinner.
const LOAD_TIMEOUT_MS = 15_000;

export function loadGoogleMaps() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Maps doit etre charge cote client."));
  }

  // ÉTAPE 28D - a map requested while the device reports itself offline can
  // only fail: say so immediately (no script request, no wait) with a message
  // fit for the driver. This deliberately comes BEFORE the "already loaded"
  // shortcut below: with Google's script already in the page, creating a map
  // offline still succeeds far enough to make Google itself pop up its own
  // "This page can't load Google Maps correctly" dialog (it cannot fetch the
  // map's configuration) - exactly the technical error the callers' own
  // "Carte indisponible" state exists to replace.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return Promise.reject(new Error("Carte indisponible hors connexion."));
  }

  if (window.google?.maps) {
    return Promise.resolve(window.google);
  }

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return Promise.reject(
      new Error("Configurez NEXT_PUBLIC_GOOGLE_MAPS_API_KEY pour afficher Google Maps."),
    );
  }

  googleMapsPromise ??= new Promise<GoogleMapsApi>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[data-comdis-google-maps="true"]',
    );

    // ÉTAPE 28D - a FAILED load must not stay cached: without this reset the
    // rejected promise below was returned to every later caller forever, so a
    // map that failed once (offline at the time) never came back until the
    // page/app was fully restarted. Clearing the promise AND the dead <script>
    // lets the next call start a genuine new attempt.
    const fail = (message: string) => {
      clearTimeout(timer);
      googleMapsPromise = null;
      document.querySelector('script[data-comdis-google-maps="true"]')?.remove();
      reject(new Error(message));
    };
    const timer = setTimeout(() => fail("Google Maps ne repond pas."), LOAD_TIMEOUT_MS);

    window.__comdisGoogleMapsInit = () => {
      clearTimeout(timer);
      if (window.google?.maps) {
        resolve(window.google);
        return;
      }

      fail("Google Maps n'a pas pu etre initialise.");
    };

    if (existingScript) {
      return;
    }

    const script = document.createElement("script");
    const params = new URLSearchParams({
      key: apiKey,
      v: "weekly",
      loading: "async",
      callback: "__comdisGoogleMapsInit",
    });

    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.defer = true;
    script.dataset.comdisGoogleMaps = "true";
    script.onerror = () => {
      fail("Impossible de charger Google Maps.");
    };

    document.head.appendChild(script);
  });

  return googleMapsPromise;
}
