"use client";

/**
 * COUNTER POS - registers /sw.js so an installed COMDIS Manager can START
 * without Internet. Called only from the counter POS (admin / cashier), after
 * a real online session and a successful local mirror - never from the driver
 * or mobile surfaces. Fail-soft: no service worker support simply means no
 * offline start; nothing else changes.
 */

export const OFFLINE_SHELL_PATH = "/hors-ligne";
export const SERVICE_WORKER_URL = "/sw.js";

let registered = false;

export function registerOfflineServiceWorker(): void {
  if (registered) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  registered = true;
  navigator.serviceWorker
    .register(SERVICE_WORKER_URL, { scope: "/", updateViaCache: "none" })
    .then(async (registration) => {
      const ready = await navigator.serviceWorker.ready;
      // Ask for a refresh of the cached shell (the worker skips it when recent).
      (ready.active ?? registration.active)?.postMessage({ type: "COMDIS_REFRESH_SHELL" });
    })
    .catch(() => {
      registered = false;
    });
}
