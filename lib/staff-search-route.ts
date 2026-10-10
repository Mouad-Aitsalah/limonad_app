import { NextResponse } from "next/server";

/** An error the route recognised as authentication/authorisation (lib/server/auth.ts's AuthServiceError). */
export type AuthErrorLike = { message: string; status: number };

/**
 * Shared error handling of the staff search routes (/api/products/search,
 * /api/customers/search). They used to turn EVERY error into a 500, so a
 * request without a staff session answered 500 instead of 401.
 *
 * - success: 200 with the payload;
 * - an authentication/authorisation error (recognised by `isAuthError`, i.e.
 *   `instanceof AuthServiceError`): its own status and message - 401 when
 *   there is no valid staff session, 403 when the user's role is not allowed
 *   (the existing access rules are untouched);
 * - ANY other error: still a 500 with the route's generic message - a real
 *   server failure is never disguised as an authentication problem.
 *
 * No server-only import, so it is unit-tested without a database
 * (lib/staff-search-route.test.ts).
 */
export async function handleStaffSearchRoute(
  run: () => Promise<Record<string, unknown>>,
  options: {
    isAuthError: (error: unknown) => error is AuthErrorLike;
    failureMessage: string;
    /** Applied to every response, e.g. the mobile-shell CORS headers. */
    wrap?: (response: NextResponse) => NextResponse;
  },
): Promise<NextResponse> {
  const wrap = options.wrap ?? ((response: NextResponse) => response);
  try {
    return wrap(NextResponse.json(await run()));
  } catch (error) {
    if (options.isAuthError(error)) {
      return wrap(NextResponse.json({ message: error.message }, { status: error.status }));
    }
    return wrap(NextResponse.json({ message: options.failureMessage }, { status: 500 }));
  }
}
