import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Goods returns are closed to drivers (lib/driver-returns-policy.ts). The behaviour is
 * proven against a real database in credit-notes.driver-access.http.integration.test.ts;
 * this file pins, without a database, the places where the closing is wired - and that
 * no driver surface (screens, mobile app, offline code) ever reaches the credit-note API.
 */

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");

function walk(directory: string, files: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "android" || entry === "ios" || entry === "dist" || entry === ".next") continue;
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) files.push(full);
  }
  return files;
}

const credit = read("lib/server/credit-notes.ts");
const driverReturn = credit.slice(credit.indexOf("export async function createDriverReturn"), credit.indexOf("async function persistManualCreditNote"));

test("the policy switch is off and carries the message the API returns", () => {
  const policy = read("lib/driver-returns-policy.ts");
  assert.match(policy, /export const DRIVER_GOODS_RETURNS_ENABLED: boolean = false;/);
  assert.match(policy, /Le retour de marchandises n'est pas disponible pour les chauffeurs\./);
});

test("POST /api/driver/returns answers 403 for everyone, never reads the body and never reaches the credit-note code", () => {
  const route = read("app/api/driver/returns/route.ts");
  assert.match(
    route,
    /export async function POST\(request: Request\) \{\s*const moduleRejection = await rejectDisabledModule\(request\);\s*if \(moduleRejection\) return moduleRejection;\s*return NextResponse\.json/,
    "module check first (the architecture rule of every route), then the 403",
  );
  assert.match(route, /\{ status: 403 \}/);
  assert.match(route, /DRIVER_GOODS_RETURNS_DISABLED_MESSAGE/);
  assert.equal(/createDriverReturn|request\.json|requireOrganizationUser|credit-notes/.test(route), false);
  assert.equal(/export async function (GET|PUT|PATCH|DELETE)/.test(route), false);
});

test("createDriverReturn: the refusal is its FIRST statement - before the session, the database and anything else", () => {
  const bodyStart = driverReturn.indexOf("Promise<CreditNote> {") + "Promise<CreditNote> {".length;
  const firstCode = driverReturn.slice(bodyStart).replace(/\r/g, "").split("\n").filter((line) => line.trim() && !line.trim().startsWith("//"))[0];
  assert.match(firstCode, /if \(!DRIVER_GOODS_RETURNS_ENABLED\) \{/);
  assert.match(driverReturn, /throw new OperationsServiceError\(DRIVER_GOODS_RETURNS_DISABLED_MESSAGE, 403\);/);
  assert.ok(driverReturn.indexOf("DRIVER_GOODS_RETURNS_ENABLED") < driverReturn.indexOf("requireOrganizationUser"));
  // the historical body is kept (not physically removed), as decided
  assert.match(driverReturn, /requireOrganizationUser\(\["driver"\]\)/);
  assert.match(driverReturn, /driver\.truck\.stockLocation\.type !== "TRUCK"/);
});

test("getReturnableProductsForCustomer is reserved to the desk roles - no driver", () => {
  const start = credit.indexOf("export async function getReturnableProductsForCustomer");
  const body = credit.slice(start, credit.indexOf("const driverReturnLineSchema"));
  assert.match(body, /requireOrganizationUser\(DESK_CREDIT_NOTE_ROLES\)/);
  assert.equal(/"driver"/.test(body.replace(/\/\/[^\n]*/g, "")), false, "no driver role left in the code of this function");
  assert.match(credit, /const DESK_CREDIT_NOTE_ROLES: UserRole\[\] = \["admin", "cashier"\];/);
});

test("no driver surface references the credit-note or driver-return API: driver pages, driver components, the mobile app, the offline code", () => {
  const surfaces = [
    "app/driver",
    "components/driver",
    "components/driver-pos",
    "components/driver-tour",
    "components/driver-stock",
    "components/driver-clients",
    "mobile/driver/src",
    "lib/offline",
  ];
  const offenders: string[] = [];
  for (const surface of surfaces) {
    for (const file of walk(join(root, surface))) {
      const text = readFileSync(file, "utf8");
      if (/api\/driver\/returns|api\/credit-notes|createDriverReturn|CreateDriverReturnInput/.test(text)) offenders.push(relative(root, file));
    }
  }
  assert.deepEqual(offenders, []);
});

test("the credit-note menu entry and pages exclude the driver; the two fixed driver labels are untouched", () => {
  const nav = read("components/layout/nav-items.ts");
  assert.match(nav, /label: "Avoir client \/ fournisseur", href: "\/avoirs", roles: \["admin", "cashier"\]/);
  // creating an avoir (the POS-style page): administrator and cashier only; reading one (the detail page) also the depot manager
  const pages: Array<[string, RegExp]> = [
    ["app/(dashboard)/avoirs/page.tsx", /const allowedRoles: UserRole\[\] = \["admin", "cashier"\];/],
    ["app/(dashboard)/avoirs/[id]/page.tsx", /const allowedRoles: UserRole\[\] = \["admin", "depot_manager", "cashier"\];/],
  ];
  for (const [page, roles] of pages) {
    const text = read(page);
    assert.match(text, roles, page);
    assert.match(text, /redirect\("\/driver"\)/, page);
  }
  // decided: these static labels stay as they are
  assert.match(read("components/driver-pos/driver-sale-detail-dialog.tsx"), /label="Avoir lie" value="Aucun"/);
  assert.match(read("components/driver-pos/driver-tour-sales-dialog.tsx"), /label="Avoirs" value=\{formatCurrency\(0\)\}/);
});

test("the tour stock sheet still counts the historical driver returns, and the tour / GPS code is not part of this change", () => {
  const tours = read("lib/server/tours.ts");
  assert.match(tours, /creditNote: \{\s*tourId: tour\.id,/);
  assert.match(tours, /for \(const line of driverReturnLines\)/);
});
