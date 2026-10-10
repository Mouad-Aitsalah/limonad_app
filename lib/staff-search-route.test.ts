import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { handleStaffSearchRoute, type AuthErrorLike } from "./staff-search-route";

/**
 * /api/products/search and /api/customers/search: no staff session -> 401
 * (403 for a forbidden role), a valid session -> 200, a real server error ->
 * still 500. No database: the search itself is a stub; the auth error is a
 * stand-in with the same shape as lib/server/auth.ts's AuthServiceError
 * (message + status), which the routes recognise with `instanceof`.
 */

class FakeAuthServiceError extends Error {
  constructor(
    message: string,
    public status = 401,
  ) {
    super(message);
  }
}
class OtherServiceError extends Error {
  constructor(
    message: string,
    public status = 401,
  ) {
    super(message);
  }
}

const options = {
  isAuthError: (error: unknown): error is AuthErrorLike => error instanceof FakeAuthServiceError,
  failureMessage: "Impossible de rechercher les produits.",
};

test("no staff session: 401 with the session message (was 500)", async () => {
  const response = await handleStaffSearchRoute(async () => {
    throw new FakeAuthServiceError("Session introuvable.", 401);
  }, options);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { message: "Session introuvable." });
});

test("authenticated but role not allowed: the existing 403 is kept", async () => {
  const response = await handleStaffSearchRoute(async () => {
    throw new FakeAuthServiceError("Acces non autorise.", 403);
  }, options);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { message: "Acces non autorise." });
});

test("valid staff session: 200 with the search result, unchanged", async () => {
  const products = [{ id: "p1", name: "Coca-Cola" }];
  const response = await handleStaffSearchRoute(async () => ({ products }), options);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { products });
});

test("a real server error stays a 500 - never disguised as 401 - and its details are not leaked", async () => {
  const response = await handleStaffSearchRoute(async () => {
    throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
  }, options);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { message: "Impossible de rechercher les produits." });

  // an error that merely CARRIES a 401 status but is not an authentication error is not an auth answer
  const other = await handleStaffSearchRoute(async () => {
    throw new OtherServiceError("Quelque chose", 401);
  }, options);
  assert.equal(other.status, 500);

  const nonError = await handleStaffSearchRoute(async () => {
    throw "boom";
  }, options);
  assert.equal(nonError.status, 500);
});

test("wrap (mobile CORS headers) is applied to every response: success, auth error and server error", async () => {
  const wrap = (response: Response) => {
    response.headers.set("x-wrapped", "yes");
    return response as never;
  };
  const ok = await handleStaffSearchRoute(async () => ({ customers: [] }), { ...options, wrap });
  const unauthenticated = await handleStaffSearchRoute(async () => {
    throw new FakeAuthServiceError("Session introuvable.", 401);
  }, { ...options, wrap });
  const failed = await handleStaffSearchRoute(async () => {
    throw new Error("db down");
  }, { ...options, wrap });
  for (const response of [ok, unauthenticated, failed]) assert.equal(response.headers.get("x-wrapped"), "yes");
  assert.deepEqual([ok.status, unauthenticated.status, failed.status], [200, 401, 500]);
});

// ---------------------------------------------------------------------------
// Wiring of the two real routes (source level - they import server-only modules)
// ---------------------------------------------------------------------------

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("both search routes map ONLY AuthServiceError to its status; customers keeps its mobile CORS wrapper", () => {
  const products = read("../app/api/products/search/route.ts");
  const customers = read("../app/api/customers/search/route.ts");
  for (const [source, message] of [
    [products, "Impossible de rechercher les produits."],
    [customers, "Impossible de rechercher les clients."],
  ] as const) {
    assert.match(source, /return handleStaffSearchRoute\(/);
    assert.match(source, /isAuthError: \(error\): error is AuthServiceError => error instanceof AuthServiceError,/);
    assert.ok(source.includes(`failureMessage: "${message}"`));
    assert.equal(/catch\s*\{/.test(source), false, "no catch-all left that turns everything into 500");
  }
  assert.match(customers, /wrap: \(response\) => withMobileCors\(request, response\),/);
  assert.match(customers, /export async function OPTIONS\(request: Request\) \{\s+return handleMobilePreflight\(request\);/);
});

test("the existing authorisation rules of the searches are unchanged (same roles)", () => {
  const productsService = read("./server/products.ts");
  const customersService = read("./server/customers.ts");
  for (const fn of ["searchProducts", "searchPosProducts"]) {
    const body = productsService.slice(productsService.indexOf(`export async function ${fn}(`));
    assert.match(body.slice(0, 600), /requireOrganizationUser\(\["admin", "depot_manager", "cashier", "driver"\]\)/, fn);
  }
  const searchCustomersBody = customersService.slice(customersService.indexOf("export async function searchCustomers("));
  assert.match(searchCustomersBody.slice(0, 600), /requireOrganizationUser\(\["admin", "depot_manager", "cashier", "driver"\]\)/);
});
