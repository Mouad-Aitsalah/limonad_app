import "server-only";

import { NextResponse } from "next/server";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Server-side CSRF defense for every mutating API route (POST/PUT/PATCH/
 * DELETE) - defense in depth alongside the session cookie's SameSite=Lax
 * (kept as-is; this is an additional layer, not a replacement).
 *
 * Deliberately does NOT rely on a hardcoded/configured "allowed origin"
 * list (that is the fragile, client-adjacent pattern the task explicitly
 * warned against: someone has to remember to keep it in sync with whatever
 * domain COMDIS is actually deployed to, and it silently breaks - or
 * silently under-protects - the day that domain changes). Instead it
 * compares the request's own claimed Origin (or, failing that, Referer)
 * against the Host this exact request was routed to - a value the server
 * itself observes for this request, not something the caller gets to
 * assert unchallenged. This is the same "Verifying Origin With Standard
 * Headers" pattern documented in the OWASP CSRF Prevention Cheat Sheet, and
 * it needs zero configuration to be correct in both development
 * (localhost:3000) and whatever production domain COMDIS ends up on.
 *
 * A GET/HEAD/OPTIONS request always passes through untouched (returns
 * null) - CSRF targets state-changing requests, and plenty of legitimate
 * GETs (direct navigation, bookmarks, a plain server-rendered page load)
 * never carry an Origin header at all, so gating those too would just
 * break normal browsing for no security benefit.
 *
 * Returns a ready-made 403 NextResponse to return immediately if the
 * request is rejected, or null if it may proceed - a plain guard-clause
 * value rather than a thrown error, so it works correctly regardless of
 * whether the call site is inside or outside a try/catch (an uncaught
 * throw here would otherwise surface as a generic 500, not a 403 - exactly
 * the mistake this shape is designed to make impossible). Call this as the
 * first line inside a mutating handler, before touching the request body
 * or any service function:
 *
 *   const csrfRejection = rejectUntrustedOrigin(request);
 *   if (csrfRejection) return csrfRejection;
 */
export function rejectUntrustedOrigin(request: Request): NextResponse | null {
  if (!MUTATING_METHODS.has(request.method)) return null;

  const claimedOrigin = originOf(request.headers.get("origin")) ?? originOf(request.headers.get("referer"));

  // No Origin AND no Referer on a POST/PUT/PATCH/DELETE is not something a
  // real browser does for a same-origin fetch/XHR/form submission (Origin
  // is sent on every "unsafe" method per the Fetch spec, same-origin or
  // not) - the one legitimate exception in COMDIS is the native background
  // GPS ping (app/api/driver/tour/location/native), which is posted
  // directly by OS-level code with no browser/WebView involved at all and
  // is authenticated by its own signed bearer token instead of the session
  // cookie - it is deliberately never routed through this check (see that
  // route's own file). Anywhere else, missing origin info means "not a
  // real browser request to this app" - fail closed rather than guess.
  if (!claimedOrigin) {
    return NextResponse.json({ message: "Requete refusee : origine manquante." }, { status: 403 });
  }

  if (claimedOrigin !== expectedOrigin(request)) {
    return NextResponse.json({ message: "Requete refusee : origine non autorisee." }, { status: 403 });
  }

  return null;
}

function originOf(headerValue: string | null): string | null {
  if (!headerValue) return null;
  try {
    return new URL(headerValue).origin;
  } catch {
    return null;
  }
}

function expectedOrigin(request: Request): string {
  // X-Forwarded-* first: correct behind whatever reverse proxy/platform
  // COMDIS is deployed behind in production, which terminates TLS and
  // proxies to this app - Host/proto as this process sees them directly
  // would otherwise reflect the internal hop, not the public domain the
  // browser actually connected to.
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const proto = forwardedProto ?? (process.env.NODE_ENV === "production" ? "https" : "http");
  return `${proto}://${host}`;
}
