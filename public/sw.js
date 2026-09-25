/* COMDIS Manager - service worker (counter POS offline start-up).
 *
 * Purpose: let an INSTALLED COMDIS Manager start and render the counter POS
 * when there is no Internet. Nothing else.
 *
 * What it does:
 *   1. Keeps a copy of the offline shell page (/hors-ligne): a static page with
 *      NO user data in it (the identity and the catalogue come from IndexedDB,
 *      decided client side by lib/offline/counter-pos/offline-startup.ts).
 *   2. Keeps the hashed build assets (/_next/static/*): public JS/CSS/fonts,
 *      immutable by name, cache-first.
 *   3. When a page NAVIGATION fails because the network is down, redirects it
 *      to the shell (which then explains what is possible). A server that
 *      answers - even with an error - is never replaced.
 *
 * What it deliberately NEVER does:
 *   - touch any /api/* request, any non-GET request, any RSC/prefetch request
 *     or any authenticated page: no response other than the shell and the
 *     static assets is ever stored;
 *   - touch /login, /driver, /mobile navigations (driver and native shells
 *     keep their own behaviour).
 * Sales made offline keep using the IndexedDB queue, not this worker.
 */

const VERSION = "v1";
const CACHE = "comdis-shell-" + VERSION;
const SHELL = "/hors-ligne";
const SHELL_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const NAVIGATION_EXCLUDED = ["/login", "/driver", "/mobile", "/api"];
const STATIC_PREFIX = "/_next/static/";

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell().catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("comdis-shell-") && name !== CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "COMDIS_REFRESH_SHELL") return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(SHELL);
      const date = cached && cached.headers.get("date");
      const age = date ? Date.now() - new Date(date).getTime() : Infinity;
      if (!cached || !(age < SHELL_MAX_AGE_MS)) await precacheShell();
    })().catch(() => undefined),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith(STATIC_PREFIX)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode !== "navigate") return;
  if (NAVIGATION_EXCLUDED.some((prefix) => url.pathname === prefix || url.pathname.startsWith(prefix + "/"))) {
    return;
  }

  if (url.pathname === SHELL) {
    event.respondWith(shellNetworkFirst(request));
    return;
  }

  // Any other page: normal network. Only a network FAILURE goes to the shell.
  event.respondWith(fetch(request).catch(() => Response.redirect(SHELL, 302)));
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.status === 200) await cache.put(request, response.clone());
  return response;
}

async function shellNetworkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (isCacheableShell(response)) await cache.put(SHELL, response.clone());
    return response;
  } catch {
    const cached = await cache.match(SHELL);
    if (cached) return cached;
    return new Response("Hors connexion : ouvrez COMDIS une première fois avec Internet.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

// A redirect (to /login when there is no session) or an error page is never the shell.
function isCacheableShell(response) {
  return (
    response.ok &&
    response.status === 200 &&
    !response.redirected &&
    (response.headers.get("content-type") || "").includes("text/html")
  );
}

async function precacheShell() {
  const cache = await caches.open(CACHE);
  const response = await fetch(SHELL, { credentials: "same-origin", cache: "reload" });
  if (!isCacheableShell(response)) return;
  const html = await response.clone().text();
  await cache.put(SHELL, response);

  const assets = new Set();
  for (const match of html.matchAll(/\/_next\/static\/[^"'\s\\)<>]+/g)) assets.add(match[0]);
  // `seen` guards against a stylesheet that (indirectly) references itself.
  const seen = new Set(assets);
  await Promise.all(Array.from(assets).map((asset) => cacheAsset(cache, asset, seen)));
}

async function cacheAsset(cache, assetUrl, seen) {
  try {
    const request = new Request(assetUrl, { credentials: "same-origin" });
    let response = await cache.match(request);
    if (!response) {
      response = await fetch(request);
      if (!response.ok || response.status !== 200) return;
      await cache.put(request, response.clone());
    }
    // Fonts / images referenced from a stylesheet.
    if (assetUrl.split("?")[0].endsWith(".css")) {
      const css = await response.clone().text();
      const base = new URL(assetUrl, self.location.origin);
      const nested = new Set();
      for (const match of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
        // data: URIs and in-document fragments (e.g. "#default#VML") are not files.
        if (match[1].startsWith("data:") || match[1].startsWith("#")) continue;
        const resolved = new URL(match[1], base);
        const path = resolved.pathname + resolved.search;
        if (
          resolved.origin === self.location.origin &&
          resolved.pathname.startsWith(STATIC_PREFIX) &&
          !seen.has(path)
        ) {
          seen.add(path);
          nested.add(path);
        }
      }
      await Promise.all(Array.from(nested).map((asset) => cacheAsset(cache, asset, seen)));
    }
  } catch {
    // best effort: the runtime cache-first fills the gap on the next online load
  }
}
