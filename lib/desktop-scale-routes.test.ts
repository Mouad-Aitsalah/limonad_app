import assert from "node:assert/strict";
import { test } from "node:test";

import { DESKTOP_SCALE_ROUTES, isDesktopScaleRoute } from "@/lib/desktop-scale-routes";

test("scales every listed page, with or without trailing slash", () => {
  assert.equal(DESKTOP_SCALE_ROUTES.length, 13);
  for (const route of DESKTOP_SCALE_ROUTES) {
    assert.equal(isDesktopScaleRoute(route), true, route);
    assert.equal(isDesktopScaleRoute(`${route}/`), true, `${route}/`);
  }
});

test("does not scale POS, driver, login, dashboard or unlisted pages", () => {
  for (const route of [
    "/",
    "/login",
    "/dashboard",
    "/pos",
    "/pos/versements",
    "/driver/pos",
    "/comptes-comptables",
    "/comptabilite/journal",
    "/chargements",
    "/utilisateurs",
    "/assistant-ia",
  ]) {
    assert.equal(isDesktopScaleRoute(route), false, route);
  }
  assert.equal(isDesktopScaleRoute(null), false);
  assert.equal(isDesktopScaleRoute(undefined), false);
});

test("sub-pages are not scaled unless listed", () => {
  assert.equal(isDesktopScaleRoute("/produits/import"), false);
  assert.equal(isDesktopScaleRoute("/comptes/import"), false);
  assert.equal(isDesktopScaleRoute("/employes/abc"), false);
});
