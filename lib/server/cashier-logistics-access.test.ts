import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { navItems } from "../../components/layout/nav-items";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const ROLE_LIST = /requireOrganizationUser\(\[([^\]]*)\]\)/g;

function roleLists(source: string): string[] {
  return [...source.matchAll(ROLE_LIST)].map((m) => m[1].replace(/\s/g, ""));
}

test("Chargements and Trajets server functions: cashier gets exactly what admin has", () => {
  for (const file of ["./truck-loadings.ts", "./truck-routes.ts", "./fleet-tracking.ts"]) {
    for (const list of roleLists(read(file))) {
      if (list.includes('"admin"')) assert.ok(list.includes('"cashier"'), `${file}: ${list}`);
      assert.equal(list.includes('"driver"') && !list.includes('"admin"'), false, `${file}: driver-only list untouched`);
    }
  }
  assert.equal(roleLists(read("./truck-loadings.ts")).filter((l) => l === '"admin","depot_manager","cashier"').length, 11);
  assert.equal(roleLists(read("./truck-routes.ts")).length, 2);
});

test("Trajets page allows cashier, layout guard unchanged", () => {
  assert.match(read("../../app/(dashboard)/trajets/page.tsx"), /allowedRoles: UserRole\[\] = \["admin", "depot_manager", "cashier"\]/);
  assert.match(read("../../app/(dashboard)/layout.tsx"), /allowedRoles=\{\["admin", "depot_manager", "cashier"\]\}/);
});

test("menu: cashier sees Chargements and Trajets like admin; driver does not", () => {
  const labels = (role: "admin" | "depot_manager" | "cashier" | "driver") =>
    navItems.flatMap((i) => (i.roles && !i.roles.includes(role) ? [] : (i.children ?? []).filter((c) => !c.roles || c.roles.includes(role)).map((c) => c.href)));
  for (const role of ["admin", "depot_manager", "cashier"] as const) {
    assert.ok(labels(role).includes("/chargements") && labels(role).includes("/trajets"), role);
  }
  assert.equal(labels("driver").includes("/chargements") || labels("driver").includes("/trajets"), false);
  // other cashier entries unchanged: still no Dépôts / Inventaire / Utilisateurs
  for (const href of ["/depots", "/inventaire", "/utilisateurs"]) assert.equal(labels("cashier").includes(href), false, href);
});
