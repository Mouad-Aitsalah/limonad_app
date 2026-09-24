"use client";

/**
 * FIX ANDROID POS PHOTOS - the Android shell's WebView origin (https://localhost,
 * see capacitor.config.ts's LOCAL mode) is cross-site to the real API origin,
 * so a plain `<img src="/api/products/[id]/image">` (a relative URL, correct
 * on the web where the page and the API share an origin) resolves against
 * the WRONG origin on Android, AND even fixed to an absolute URL, a bare
 * `<img>` tag request carries neither the mobile shell's `Authorization:
 * Bearer` header (browsers never let `<img>` set custom headers) nor the
 * web app's HttpOnly session cookie (cross-site, never sent) - the image
 * route (app/api/products/[id]/image/route.ts) requires one or the other.
 *
 * This is the one place components/products/product-media.tsx (shared with
 * the web app, completely unaware of Capacitor) learns the two things it
 * needs to fetch that route itself, authenticated, ONLY when actually
 * running natively (Capacitor.isNativePlatform() - always false on the web,
 * where this module is simply never configured and product-media.tsx keeps
 * using the plain same-origin, cookie-authenticated <img> path unchanged).
 *
 * Configured once by mobile/driver/src/App.tsx whenever its own token/
 * API_BASE_URL are known (mirrors the same values every other shell fetch
 * already uses - see mobile/driver/src/lib/api-base.ts, mobile-fetch.ts).
 */
type NativeMediaAuth = {
  apiBaseUrl: string | null;
  token: string | null;
};

let current: NativeMediaAuth = { apiBaseUrl: null, token: null };

export function configureNativeMediaAuth(config: NativeMediaAuth): void {
  current = config;
}

export function getNativeMediaAuth(): NativeMediaAuth {
  return current;
}
