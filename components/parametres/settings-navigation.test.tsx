import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { getNavigationLinks, getNavigationPageLabel, getVisibleNavItems } from "@/components/layout/navigation";
import { SETTINGS_SECTIONS, SettingsNav } from "@/components/parametres/settings-nav";
import type { UserRole } from "@/types/auth";

const administration = (role: UserRole) => getVisibleNavItems(role).find((item) => item.label === "Administration");

test("sidebar: an admin finds Tarification under Administration, after Paramètres (unchanged)", () => {
  assert.deepEqual(
    administration("admin")?.children?.map((child) => [child.label, child.href]),
    [
      ["Utilisateurs", "/utilisateurs"],
      ["Paramètres", "/parametres/identite"],
      ["Tarification", "/parametres/tarification"],
      ["Personnalisation des tableaux", "/parametres/tableaux"],
    ],
  );
  assert.equal(getNavigationPageLabel("/parametres/tableaux", "admin"), "Personnalisation des tableaux");
  // the mobile launcher is built from the same list
  assert.ok(getNavigationLinks("admin").some((link) => link.href === "/parametres/tarification"));
  assert.equal(getNavigationPageLabel("/parametres/tarification", "admin"), "Tarification");
  assert.equal(getNavigationPageLabel("/parametres/identite", "admin"), "Paramètres");
});

test("sidebar: no other role sees the settings entries", () => {
  for (const role of ["cashier", "depot_manager", "driver", "super_admin"] as UserRole[]) {
    assert.equal(administration(role), undefined, role);
    assert.equal(getNavigationLinks(role).some((link) => link.href.startsWith("/parametres/")), false, role);
  }
});

test("sidebar: on /parametres/tarification only the Tarification entry is highlighted", () => {
  const source = readFileSync(path.join(process.cwd(), "components/layout/sidebar-item.tsx"), "utf8");
  // the rule the sidebar applies to a child entry
  assert.match(source, /const childActive =\s*pathname === child\.href \|\|\s*\(!child\.exact && pathname\.startsWith\(`\$\{child\.href\}\/`\)\);/);
  const active = (pathname: string) =>
    administration("admin")!.children!.filter((child) => pathname === child.href || (!child.exact && pathname.startsWith(`${child.href}/`))).map((child) => child.label);
  assert.deepEqual(active("/parametres/tarification"), ["Tarification"]);
  assert.deepEqual(active("/parametres/identite"), ["Paramètres"]);
});

test("Paramètres pages: a sub-navigation links every section", () => {
  assert.deepEqual(SETTINGS_SECTIONS.map((section) => section.href), ["/parametres/identite", "/parametres/tarification", "/parametres/tableaux"]);
  const markup = renderToStaticMarkup(<SettingsNav />);
  assert.match(markup, /<nav aria-label="Sections des paramètres"/);
  assert.match(markup, /href="\/parametres\/identite"[^>]*>Identité de l&#x27;entreprise</);
  assert.match(markup, /href="\/parametres\/tarification"[^>]*>Tarification</);
  assert.match(markup, /href="\/parametres\/tableaux"[^>]*>Personnalisation des tableaux</);
  for (const view of ["company-identity-view.tsx", "pricing-settings-view.tsx", "table-labels-settings-view.tsx"]) {
    assert.match(readFileSync(path.join(process.cwd(), "components/parametres", view), "utf8"), /<SettingsNav \/>/, view);
  }
  // both pages stay admin-only on the server
  const settings = readFileSync(path.join(process.cwd(), "lib/server/organization-settings.ts"), "utf8");
  assert.match(settings, /export async function getPricingSettingsForAdmin[\s\S]*?requireOrganizationUser\(\["admin"\]\)/);
  const identity = readFileSync(path.join(process.cwd(), "lib/server/organization-identity.ts"), "utf8");
  assert.match(identity, /export async function getOrganizationIdentityForAdmin[\s\S]*?requireOrganizationUser\(\["admin"\]\)/);
});
