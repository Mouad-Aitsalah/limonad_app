import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Server/proxy-level DEFENSE IN DEPTH for page routes, per finding #8 of
 * the security audit. This is Next.js 16's "Proxy" file convention (the
 * renamed successor to "Middleware" - see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md,
 * confirmed against the Next.js version actually installed here rather
 * than assumed from training data, per AGENTS.md).
 *
 * ============================================================================
 * WHAT THIS DOES, AND WHY IT CANNOT DO MORE
 * ============================================================================
 *
 * COMDIS sessions (see lib/server/auth.ts, finding #4) are server-side and
 * revocable BY DESIGN: the cookie carries a bare opaque random token with
 * zero embedded information - no user id, no role, no organization, not
 * even a signature to verify offline. The only way to learn anything about
 * a token - whether it corresponds to a real session at all, whether that
 * session is revoked/expired, and who it belongs to - is a lookup against
 * the Session table in Postgres (tokenHash -> row), then a second lookup of
 * that row's User for role/status/organization.
 *
 * That is deliberately NOT something this file attempts:
 *
 *  - Next.js's own docs are explicit that Proxy "is not intended for slow
 *    data fetching" and warn against using it "as a full session
 *    management or authorization solution" - full DB-backed checks belong
 *    "as close as possible to your data source" (their words), which is
 *    exactly where lib/server/auth.ts's requireOrganizationUser() /
 *    requireSessionUser() already live.
 *  - Proxy defaults to the Node.js runtime as of Next.js 16 (a change from
 *    the historical Edge-only default), so a Prisma call is technically
 *    reachable here - but "technically possible" is not "advisable".
 *    Proxy is documented to run "separately of your render code", is
 *    optimized to be deployable to a CDN edge independent of the main app
 *    process, and is explicitly warned against "relying on shared modules
 *    or globals" - lib/prisma.ts's pooled client is exactly such a global,
 *    and there is no guarantee it survives or behaves the same way across
 *    Proxy invocations as it does inside a normal request. Combined with
 *    this project's own observed Neon connectivity hiccups this session
 *    (multi-second latency, and once a multi-minute full outage - see the
 *    findings #1-#4 conversation), putting a database round trip in front
 *    of literally every navigation would turn a transient DB blip into a
 *    total application outage, for a check that already exists correctly
 *    downstream. That is a worse security AND availability trade than not
 *    having this file at all.
 *
 * So: this is an OPTIMISTIC check only, exactly the pattern Next.js's own
 * authentication guide recommends for Proxy
 * (node_modules/next/dist/docs/01-app/02-guides/authentication.md,
 * "Optimistic checks with Proxy (Optional)") - with one adaptation forced
 * by COMDIS's specific architecture: their example DECODES a self-
 * sufficient signed cookie to read a role/userId claim optimistically.
 * COMDIS's cookie has no claims to decode - it is opaque on purpose, which
 * is what makes it properly revocable. The only optimistic fact available
 * here without a DB call is binary: does a comdis.session cookie exist at
 * all? That is genuinely useful (it turns "definitely logged out" into an
 * instant redirect before any React rendering, data fetching, or RouteGuard
 * client JS ever runs) but it proves nothing else: a garbage/forged/
 * expired/revoked cookie value passes this check identically to a real
 * one. This file NEVER decides who a user is, what role they have, or what
 * organization they belong to - it only ever asks "is there a plausible
 * reason to bother rendering this page at all?".
 *
 * ============================================================================
 * THE ACTUAL AUTHORITY - UNCHANGED, STILL MANDATORY
 * ============================================================================
 *
 * Every protected page's data still flows through lib/server/*.ts
 * functions that call requireOrganizationUser()/requireSessionUser() (or
 * requireSuperAdmin()) - the only place role, organizationId, and session
 * validity are ever actually decided, always freshly re-checked against
 * the database on every request. Nothing here replaces that, shortcuts it,
 * or is allowed to be treated as equivalent to it. A request that clears
 * this file with a forged cookie receives no protected data whatsoever -
 * it simply fails one layer later, inside the real check, the same way it
 * always has.
 *
 * ============================================================================
 * SCOPE
 * ============================================================================
 *
 * Deliberately does NOT run on /api/* at all (see matcher below): every
 * mutating API route already has real, per-request authorization
 * (requireOrganizationUser/requireSessionUser) and CSRF origin
 * verification (finding #5, lib/server/csrf.ts); GET API routes likewise
 * already call the real session check. Layering an optimistic cookie
 * check in front of them adds no protection those routes don't already
 * have for real, while adding real risk of this file's route list ever
 * drifting out of sync with the API surface (login, logout, the session
 * probe, and the bearer-token-authenticated native GPS endpoint all live
 * under /api and must never be blocked - simplest and safest is to never
 * touch /api at all here).
 *
 * Everything else - every page route, across every route group
 * ((dashboard), driver, organisations, and any future one) - is protected
 * by default: a request with no session cookie at all is redirected to
 * /login before any of it renders. /login itself is the sole page-level
 * exception (it would otherwise redirect to itself).
 */

const SESSION_COOKIE = "comdis.session"; // must stay in sync with lib/server/auth.ts's SESSION_COOKIE - duplicated deliberately rather than imported, see the "shared modules/globals" note above.

const PUBLIC_PATHS = new Set<string>(["/login"]);

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  if (!request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Excludes: /api/* entirely (see doc comment above), Next.js internals,
    // and any request for a file with a static-asset-looking extension
    // (covers /favicon.ico, /public/*.svg, and future assets alike without
    // needing to enumerate each one).
    "/((?!api|_next/static|_next/image|.*\\.[\\w]+$).*)",
  ],
};
