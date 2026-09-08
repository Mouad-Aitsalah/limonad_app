import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { navItems } from "../components/layout/nav-items";
import { driverNavItems } from "../components/driver/driver-nav-items";
import { getNavigationLinks, getNavigationPageLabel } from "../components/layout/navigation";
import { getBrowserHomeRoute } from "../lib/auth/browser-home-route";
import { getDefaultRouteForRole } from "../lib/auth/default-route";
import type { UserRole } from "../types/auth";

const roles: UserRole[] = ["admin", "super_admin", "driver", "cashier", "depot_manager"];

for (const role of roles) {
  // Compare against the original sidebar rules, including both levels of
  // role filtering and super-admin's explicit grants only.
  const allowed = (item: { roles?: UserRole[] }) => role === "super_admin"
    ? item.roles?.includes(role) ?? false
    : !item.roles || item.roles.includes(role);
  const expected = role === "driver"
    ? driverNavItems.map((item) => item.href)
    : navItems.filter(allowed).flatMap((item) => [
      ...(item.href ? [item.href] : []),
      ...(item.children ?? []).filter(allowed).map((child) => child.href),
    ]);
  const actual = getNavigationLinks(role).map((item) => item.href);
  assert.deepEqual(actual, expected, `${role}: desktop/mobile access parity`);
  assert.equal(new Set(actual).size, actual.length, `${role}: duplicate links`);
  for (const href of actual) {
    assert.ok([
      `app${href}/page.tsx`,
      `app/(dashboard)${href}/page.tsx`,
    ].some(existsSync), `${role}: route does not exist: ${href}`);
  }
  console.log(`PASS ${role}: ${actual.length} existing, authorized destinations`);
}

assert.deepEqual(getNavigationLinks(undefined), []);
assert.deepEqual(getNavigationLinks("super_admin").map((item) => item.href), ["/organisations"]);
assert.ok(getNavigationLinks("driver").every((item) => item.href === "/driver" || item.href.startsWith("/driver/")));
for (const role of ["cashier", "depot_manager"] as const) {
  assert.ok(!getNavigationLinks(role).some((item) => ["/utilisateurs", "/employes", "/depots", "/contacts"].includes(item.href)));
}
assert.ok(!getNavigationLinks("cashier").some((item) => ["/inventaire", "/chargements", "/trajets"].includes(item.href)));
assert.ok(!getNavigationLinks("depot_manager").some((item) => item.href === "/avoirs"));
assert.equal(getNavigationPageLabel("/pos/versements", "admin"), "Versements");
assert.equal(getNavigationPageLabel("/employes/avances-salaire", "admin"), "Avances / Salaire");
assert.equal(getNavigationPageLabel("/driver/pos", "driver"), "Point de vente");

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
try {
  for (const width of [375, 390, 430, 768, 1023, 1024, 1440]) {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { matchMedia: () => ({ matches: width >= 1024 }) },
    });
    for (const role of roles) {
      assert.equal(getBrowserHomeRoute(role), width < 1024 ? "/mobile" : getDefaultRouteForRole(role));
    }
    console.log(`PASS ${width}px: initial route for all roles`);
  }
} finally {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
}
