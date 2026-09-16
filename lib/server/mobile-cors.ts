import "server-only";

import { NextResponse } from "next/server";

/**
 * PHASE 5A.1 - "4. CORS STRICT" / "5. CORS CENTRALISÉ".
 *
 * The mobile driver shell (see mobile/driver/) runs at its own Capacitor
 * origin - `https://localhost` on Android by default (no `server.androidScheme`
 * override exists in capacitor.config.ts) - which is cross-site to
 * https://limonad-app.vercel.app. Its calls therefore need real CORS, unlike
 * every existing web route, which has never needed one (the web app's own
 * origin IS the API's origin). This module is the single place that origin
 * allowlist lives, so it is never copy-pasted per route.
 *
 * Deliberately narrow: only the specific routes the shell actually calls opt
 * into this (by calling the two functions below) - originally /api/mobile/*
 * and /api/driver/*, joined by /api/customers/search and
 * /api/customers/by-number once the shell's own customer picker/N° client
 * box started calling them too (see those routes' own doc comments) - every
 * other route is completely untouched and keeps working exactly as before.
 *
 * Never `Access-Control-Allow-Origin: *` - these routes accept a bearer
 * token via the `Authorization` header, and a wildcard origin combined with
 * a credential-bearing header is exactly the pattern to avoid. Mobile auth
 * is Bearer, not cookies, so `Access-Control-Allow-Credentials` is never
 * needed either - a bearer token is never sent "ambiently" by a browser the
 * way a cookie is, so there is no CSRF-shaped risk here to defend against.
 */

const ALLOWED_METHODS = "GET,POST,OPTIONS";
const ALLOWED_HEADERS = "Authorization,Content-Type";
const PREFLIGHT_MAX_AGE_SECONDS = 600;

function allowedOrigins(): Set<string> {
  const configured = process.env.MOBILE_SHELL_ALLOWED_ORIGINS;
  const list = (configured && configured.trim().length > 0 ? configured : "https://localhost")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set(list);
}

/** Returns the request's Origin header ONLY if it is in the explicit
 *  allowlist - never a wildcard, never an unchecked echo of whatever the
 *  caller sent. */
export function resolveAllowedMobileOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  return allowedOrigins().has(origin) ? origin : null;
}

/** Attaches the CORS headers to an already-built response, when (and only
 *  when) the request's origin is on the allowlist. Always add `Vary: Origin`
 *  alongside it so a shared cache never serves one origin's CORS headers to
 *  another. */
export function withMobileCors(request: Request, response: NextResponse): NextResponse {
  const origin = resolveAllowedMobileOrigin(request);
  if (origin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.append("Vary", "Origin");
  }
  return response;
}

/** Full preflight (OPTIONS) response - 204 with the CORS headers for an
 *  allowed origin, or a plain 403 with NO Access-Control-Allow-Origin header
 *  at all for anything else (so the browser blocks the real request). */
export function handleMobilePreflight(request: Request): NextResponse {
  const origin = resolveAllowedMobileOrigin(request);
  if (!origin) {
    return new NextResponse(null, { status: 403 });
  }

  const response = new NextResponse(null, { status: 204 });
  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Access-Control-Allow-Methods", ALLOWED_METHODS);
  response.headers.set("Access-Control-Allow-Headers", ALLOWED_HEADERS);
  response.headers.set("Access-Control-Max-Age", String(PREFLIGHT_MAX_AGE_SECONDS));
  response.headers.append("Vary", "Origin");
  return response;
}
