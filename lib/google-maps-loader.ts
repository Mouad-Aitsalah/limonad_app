"use client";

let googleMapsPromise: Promise<GoogleMapsApi> | null = null;

export function loadGoogleMaps() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Maps doit etre charge cote client."));
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

    window.__comdisGoogleMapsInit = () => {
      if (window.google?.maps) {
        resolve(window.google);
        return;
      }

      reject(new Error("Google Maps n'a pas pu etre initialise."));
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
      reject(new Error("Impossible de charger Google Maps."));
    };

    document.head.appendChild(script);
  });

  return googleMapsPromise;
}
