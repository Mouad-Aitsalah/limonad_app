import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { getNavigationLinks, getVisibleNavItems } from "@/components/layout/navigation";
import { navItems } from "@/components/layout/nav-items";
import { getDefaultRouteForRole } from "@/lib/auth/default-route";
import { API_MODULE_RULES, resolveApiModuleRule } from "@/lib/modules/api-rules";
import { decideApiModuleAccess } from "@/lib/modules/module-access-core";
import {
  ASSISTANT_TOOL_MODULES,
  MODULES,
  MODULE_KEYS,
  isEssentialModule,
  moduleForPagePath,
  type ModuleKey,
} from "@/lib/modules/registry";
import {
  disabledModulesFromSettings,
  isAnyModuleEnabled,
  isAssistantToolAllowed,
  isModuleEnabled,
  parseModuleSettings,
  resolveModuleStates,
  validateModuleSettingsInput,
} from "@/lib/modules/settings";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");

function walk(dir: string, name: string, out: string[] = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, name, out);
    else if (entry.name === name) out.push(full);
  }
  return out;
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** The body of `export async function METHOD(...) { ... }` (brace matching). */
function handlerBody(source: string, method: string): string | null {
  const signature = new RegExp(`export async function ${method}\\(`).exec(source);
  if (!signature) return null;
  let index = signature.index + signature[0].length;
  for (let depth = 1; depth > 0; index += 1) {
    if (source[index] === "(") depth += 1;
    else if (source[index] === ")") depth -= 1;
  }
  const open = source.indexOf("{", index);
  let depth = 0;
  for (let cursor = open; cursor < source.length; cursor += 1) {
    if (source[cursor] === "{") depth += 1;
    else if (source[cursor] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, cursor + 1);
    }
  }
  return null;
}

const apiRoutes = walk(path.join(ROOT, "app/api"), "route.ts").map((file) => ({
  file,
  route: "/" + path.relative(path.join(ROOT, "app"), path.dirname(file)).replace(/\\/g, "/"),
  source: readFileSync(file, "utf8").replace(/\r\n/g, "\n"),
}));

// --- Defaults and stored values ---------------------------------------------

test("default: every module is enabled for an organisation without settings (existing and new organisations)", () => {
  for (const stored of [null, undefined, {}, { modules: {} }, "garbage", [], { modules: [] }, { modules: "x" }]) {
    assert.deepEqual(disabledModulesFromSettings(stored), [], JSON.stringify(stored));
    assert.ok(resolveModuleStates(stored).every((state) => state.enabled));
  }
  assert.equal(resolveModuleStates(null).length, MODULE_KEYS.length);
});

test("only an explicit false disables a module; unknown keys, non-booleans and essential modules are ignored", () => {
  const stored = {
    modules: { stock: false, gps: false, pos: true, unknownModule: false, dashboard: "false", products: false, settings: false },
  };
  assert.deepEqual(parseModuleSettings(stored), { modules: { stock: false, gps: false, pos: true } });
  assert.deepEqual(disabledModulesFromSettings(stored), ["stock", "gps"]);
  assert.equal(isModuleEnabled(["products", "settings"], "products"), true, "essential: always enabled");
  assert.equal(isModuleEnabled(["stock"], "stock"), false);
  assert.equal(isModuleEnabled(undefined, "stock"), true);
});

test("essential modules are exactly the catalogue and the settings", () => {
  assert.deepEqual(MODULES.filter((module) => module.essential).map((module) => module.key), ["products", "settings"]);
  assert.equal(new Set(MODULES.map((module) => module.key)).size, MODULES.length);
  assert.deepEqual(MODULES.map((module) => module.key), [...MODULE_KEYS]);
});

test("the SUPER_ADMIN input is validated strictly (unknown module, non-boolean, essential module refused)", () => {
  assert.deepEqual(validateModuleSettingsInput({ modules: { stock: false, pos: true } }), {
    ok: true,
    settings: { modules: { stock: false } },
  });
  assert.deepEqual(validateModuleSettingsInput({ modules: {} }), { ok: true, settings: { modules: {} } });
  for (const input of [null, {}, { modules: [] }, { modules: { nope: false } }, { modules: { stock: "no" } }, { modules: { products: false } }]) {
    assert.equal(validateModuleSettingsInput(input).ok, false, JSON.stringify(input));
  }
  assert.equal(validateModuleSettingsInput({ modules: { settings: true } }).ok, true, "keeping an essential module on is fine");
});

// --- Pages ------------------------------------------------------------------

test("every menu entry belongs to a known module; sub-pages follow the most specific prefix", () => {
  const expected: Record<string, ModuleKey | null> = {
    "/organisations": null,
    "/dashboard": "dashboard",
    "/pos": "pos",
    "/pos/versements": "deposits",
    "/ventes": "salesArchive",
    "/ventes/journalieres": "dailyInvoices",
    "/ventes/commandes-en-ligne": "customerOrders",
    "/avoirs": "creditNotes",
    "/produits": "products",
    "/categories": "products",
    "/stock": "stock",
    "/depots": "stock",
    "/inventaire": "inventory",
    "/camions": "trucks",
    "/chargements": "stockTransfers",
    "/trajets": "gps",
    "/achats/nouveau": "purchases",
    "/achats": "purchases",
    "/comptes": "accounts",
    "/contacts": "contacts",
    "/employes": "employees",
    "/employes/avances-salaire": "employees",
    "/comptabilite/journal": "accounting",
    "/comptabilite/ecritures": "accounting",
    "/comptabilite/reglements-clients": "accounting",
    "/comptabilite/solde-clients": "accounting",
    "/comptabilite/comptes": "accounting",
    "/comptabilite/parametres": "accounting",
    "/utilisateurs": "users",
    "/parametres/identite": "settings",
    "/parametres/tarification": "settings",
    "/parametres/tableaux": "settings",
    "/assistant-ia": "assistant",
  };
  const hrefs = navItems.flatMap((item) => [item.href, ...(item.children ?? []).map((child) => child.href)]).filter(Boolean) as string[];
  for (const href of hrefs) {
    assert.ok(href in expected, `menu entry ${href} has an explicit expectation`);
    assert.equal(moduleForPagePath(href), expected[href], href);
  }
  assert.equal(moduleForPagePath("/chargements/abc"), "stockTransfers");
  assert.equal(moduleForPagePath("/driver/pos"), "driverApp");
  assert.equal(moduleForPagePath("/client/catalog"), "customerOrders");
  assert.equal(moduleForPagePath("/stockxyz"), null, "segment boundary");
  for (const free of ["/", "/login", "/mobile", "/module-indisponible", "/hors-ligne", "/organisations/abc"]) {
    assert.equal(moduleForPagePath(free), null, free);
  }
});

test("every page of a toggleable module calls requireModulePage with its own module (server side, not just the menu)", () => {
  const pages = [
    ...walk(path.join(ROOT, "app/(dashboard)"), "page.tsx"),
    ...walk(path.join(ROOT, "app/driver"), "page.tsx"),
  ];
  assert.ok(pages.length > 40);
  for (const file of pages) {
    const route = "/" + path.relative(path.join(ROOT, "app"), path.dirname(file)).replace(/\\/g, "/").replace(/^\(dashboard\)\/?/, "");
    const source = readFileSync(file, "utf8");
    const moduleKey = moduleForPagePath(route);
    const redirectOnly = /export default (?:async )?function \w+\([^)]*\) \{\s*redirect\(/.test(source);
    if (!moduleKey || isEssentialModule(moduleKey) || redirectOnly) continue;
    assert.match(
      source,
      new RegExp(`export default async function \\w+\\([^)]*(?:\\)|\\{[\\s\\S]*?\\}\\))[^{]*\\{\\s*await requireModulePage\\("${moduleKey}"\\);`),
      `${route} must start with requireModulePage("${moduleKey}")`,
    );
  }
});

test("the module-unavailable page is outside every role-guarded layout and offers a way out", () => {
  const page = read("app/module-indisponible/page.tsx");
  assert.match(page, /getDefaultRouteForRole\(user\.role, user\.disabledModules\)/);
  assert.match(page, /<ModuleUnavailableActions homeHref=\{homeHref\} \/>/);
  assert.match(read("components/auth/module-unavailable-actions.tsx"), /Se déconnecter/);
});

// --- API routes ---------------------------------------------------------------

test("every API route and method is covered by an explicit rule (no route left unmapped)", () => {
  assert.ok(apiRoutes.length >= 160);
  for (const { route, source } of apiRoutes) {
    for (const method of METHODS) {
      if (!handlerBody(source, method)) continue;
      assert.ok(resolveApiModuleRule(route, method), `${method} ${route} has no module rule`);
    }
  }
  // every rule targets a real route (no stale rule)
  for (const rule of API_MODULE_RULES) {
    const prefix = rule.path.replace(/\/\*\*$/, "");
    assert.ok(
      apiRoutes.some(({ route }) => route === prefix || route.startsWith(`${prefix}/`)),
      `rule ${rule.path} matches no route`,
    );
  }
});

test("every module route checks its module FIRST, before any other work", () => {
  let guarded = 0;
  for (const { route, source } of apiRoutes) {
    for (const method of METHODS) {
      const body = handlerBody(source, method);
      if (!body) continue;
      const rule = resolveApiModuleRule(route, method)!;
      if (rule.essential !== undefined || rule.auth === "client") continue;
      if (rule.auth === "trackingToken") {
        // token branch: the organisation of the verified token; session branch: the session
        assert.match(body, /rejectDisabledModuleForOrganization\(request, claims\.organizationId\)/, `${method} ${route}`);
        guarded += 1;
        continue;
      }
      assert.match(
        body,
        /^\{\s*const moduleRejection = await rejectDisabledModule\(request\);\s*if \(moduleRejection\) return (?:moduleRejection|withMobileCors\(request, moduleRejection\));/,
        `${method} ${route} must start with rejectDisabledModule(request)`,
      );
      guarded += 1;
    }
  }
  assert.ok(guarded >= 150, `only ${guarded} guarded handlers`);
  // the session branch of the GPS batch route is checked as well
  const batch = read("app/api/driver/tour/location/batch/route.ts");
  assert.match(batch, /const moduleRejection = await rejectDisabledModule\(request\);\s*if \(moduleRejection\) return withMobileCors\(request, moduleRejection\);\s*const csrfRejection = rejectUntrustedCookieOrigin\(request\);/);
});

test("access decision: a disabled module is refused, a shared route stays open while one of its modules is enabled", () => {
  const org = "org-a";
  const refused = decideApiModuleAccess({ pathname: "/api/stock", method: "GET", organizationId: org, disabledModules: ["stock"] });
  assert.deepEqual(refused, { allowed: false, reason: "disabled", modules: ["stock"] });
  assert.equal(decideApiModuleAccess({ pathname: "/api/stock", method: "GET", organizationId: org, disabledModules: ["gps"] }).allowed, true);
  // the invoice detail: POS, archives and daily invoices
  const detail = { pathname: "/api/sales/abc123", method: "GET", organizationId: org };
  assert.equal(decideApiModuleAccess({ ...detail, disabledModules: ["pos", "salesArchive"] }).allowed, true);
  assert.equal(decideApiModuleAccess({ ...detail, disabledModules: ["pos", "salesArchive", "dailyInvoices"] }).allowed, false);
  // revising a sale is the POS only
  assert.equal(decideApiModuleAccess({ ...detail, method: "PATCH", disabledModules: ["pos"] }).allowed, false);
  // essential routes always answer (login, session, SUPER_ADMIN, catalogue, settings)
  for (const [pathname, method] of [
    ["/api/auth/login", "POST"],
    ["/api/auth/session", "GET"],
    ["/api/organizations/x/modules", "PUT"],
    ["/api/products/search", "GET"],
    ["/api/organization/identity", "GET"],
  ]) {
    assert.equal(
      decideApiModuleAccess({ pathname, method, organizationId: org, disabledModules: [...MODULE_KEYS] }).allowed,
      true,
      `${method} ${pathname}`,
    );
  }
  // no organisation session: the route's own authentication answers (401), unchanged
  assert.deepEqual(decideApiModuleAccess({ pathname: "/api/stock", method: "GET", organizationId: null, disabledModules: undefined }), {
    allowed: true,
    reason: "no-organisation",
  });
  // a route missing from the rules is refused (fail closed)
  assert.equal(decideApiModuleAccess({ pathname: "/api/unknown", method: "GET", organizationId: org, disabledModules: [] }).allowed, false);
});

test("GPS: positions are refused for the organisation of the signed token, before anything is stored", () => {
  for (const file of ["app/api/driver/tour/location/batch/route.ts", "app/api/driver/tour/location/native/route.ts"]) {
    const source = read(file);
    const check = source.indexOf("rejectDisabledModuleForOrganization(request, claims.organizationId)");
    const store = source.search(/recordDriverLocation(?:Batch)?ForDriver\(/);
    assert.ok(check > 0 && check < store, `${file}: module check before storing`);
  }
  assert.deepEqual(resolveApiModuleRule("/api/driver/tour/location-token", "POST")?.modules, ["gps"]);
  assert.deepEqual(resolveApiModuleRule("/api/trucks/live", "GET")?.modules, ["gps"]);
});

test("Espace client: closed with 'Commandes en ligne' (login refused, open sessions no longer recognised)", () => {
  const clientAuth = read("lib/server/client-auth.ts");
  assert.match(clientAuth, /const \{ identity \} = result;\s*if \(!\(await isOrganizationModuleEnabled\(identity\.organizationId, "customerOrders"\)\)\) \{\s*throw new ClientAuthError\(CLIENT_SPACE_DISABLED_MESSAGE, 403\);/);
  assert.match(clientAuth, /if \(!identity\) return null;\s*if \(!\(await isOrganizationModuleEnabled\(identity\.organizationId, "customerOrders"\)\)\) return null;/);
  // every /api/client route goes through requireClient / getCurrentClient / loginClient
  for (const { route, source } of apiRoutes.filter(({ route }) => route.startsWith("/api/client/"))) {
    assert.match(source, /requireClient\(|getCurrentClient\(|loginClient\(|logoutClient\(/, route);
  }
});

test("the assistant cannot read a disabled module: each tool is mapped, filtered and refused at execution", () => {
  const chat = read("app/api/ai/chat/route.ts");
  // the declarations of the tools (an orderBy { name: "asc" } is not a tool)
  const declared = [...chat.matchAll(/^ {4}name: "([a-z_]+)",$/gm)].map((match) => match[1]);
  assert.ok(declared.length >= 13, `${declared.length} declared tools`);
  for (const name of [...declared, "prepare_pos_sale", "get_purchase_recommendations"]) {
    assert.ok(name in ASSISTANT_TOOL_MODULES, `tool ${name} has a module mapping`);
  }
  assert.match(chat, /functionDeclarations\.filter\(\(declaration\) =>\s*isAssistantToolAllowed\(declaration\.name, user\.disabledModules\),/);
  assert.equal((chat.match(/tools: \[\{ functionDeclarations: allowedFunctionDeclarations \}\]/g) ?? []).length, 2);
  assert.match(chat, /if \(!isAssistantToolAllowed\(functionCall\.name, user\.disabledModules\)\) \{/);
  assert.equal(isAssistantToolAllowed("check_stock", ["stock"]), false);
  assert.equal(isAssistantToolAllowed("check_stock", []), true);
  assert.equal(isAssistantToolAllowed("get_product_count", [...MODULE_KEYS]), true, "catalogue tools stay");
  assert.equal(isAssistantToolAllowed("get_invoice", ["salesArchive"]), true, "still readable from the daily invoices");
  assert.equal(isAssistantToolAllowed("unknown_tool", []), false);
  assert.equal(isAnyModuleEnabled([], []), true);
});

// --- Menu and landing ----------------------------------------------------------

test("the menu hides the entries of a disabled module only; without disabled modules it is unchanged", () => {
  for (const role of ["admin", "depot_manager", "cashier", "driver", "super_admin"] as const) {
    assert.deepEqual(getVisibleNavItems(role, []), getVisibleNavItems(role), role);
    assert.deepEqual(getVisibleNavItems(role, undefined), getVisibleNavItems(role), role);
  }
  const links = getNavigationLinks("admin", ["stock", "gps", "dashboard"]).map((link) => link.href);
  for (const hidden of ["/stock", "/depots", "/trajets", "/dashboard"]) assert.equal(links.includes(hidden), false, hidden);
  for (const kept of ["/produits", "/categories", "/pos", "/inventaire", "/parametres/identite"]) assert.ok(links.includes(kept), kept);
  // a group whose children are all disabled disappears
  const groups = getVisibleNavItems("admin", ["employees"]).map((item) => item.label);
  assert.equal(groups.includes("Table employé"), false);
  assert.equal(getVisibleNavItems("driver", ["driverApp"]).length, 0);
  // the SUPER_ADMIN space is never a module
  assert.deepEqual(getNavigationLinks("super_admin", [...MODULE_KEYS]).map((link) => link.href), ["/organisations"]);
});

test("every menu (desktop sidebar, driver sidebar, mobile launcher) receives the disabled modules", () => {
  assert.match(read("components/layout/sidebar.tsx"), /getVisibleNavItems\(currentUser\?\.role, currentUser\?\.disabledModules\)/);
  assert.match(read("components/driver/driver-sidebar.tsx"), /getVisibleNavItems\(currentUser\?\.role, currentUser\?\.disabledModules\)/);
  const launcher = read("components/mobile/mobile-launcher.tsx");
  assert.match(launcher, /\{ role: liveAuth\.currentUser\.role, disabledModules: liveAuth\.currentUser\.disabledModules \}/);
  assert.match(launcher, /getNavigationLinks\(currentUser\.role, currentUser\.disabledModules\)/);
});

test("landing after login skips a disabled default page (never a dead end for staff)", () => {
  assert.equal(getDefaultRouteForRole("admin"), "/dashboard");
  assert.equal(getDefaultRouteForRole("admin", []), "/dashboard");
  assert.equal(getDefaultRouteForRole("admin", ["dashboard"]), "/pos");
  assert.equal(getDefaultRouteForRole("admin", ["dashboard", "pos", "salesArchive", "dailyInvoices", "stock"]), "/produits");
  assert.equal(getDefaultRouteForRole("cashier", ["pos"]), "/ventes");
  assert.equal(getDefaultRouteForRole("driver", ["driverApp"]), "/module-indisponible?module=driverApp");
  assert.equal(getDefaultRouteForRole("super_admin", [...MODULE_KEYS]), "/organisations");
  for (const caller of ["components/auth/login-form.tsx", "components/auth/home-redirect.tsx", "app/api/auth/login/route.ts", "components/mobile/mobile-launcher.tsx"]) {
    assert.match(read(caller), /disabledModules/, caller);
  }
});

test("the session carries the disabled modules (one query) and keeps its former shape when none is disabled", () => {
  const auth = read("lib/server/auth.ts");
  assert.match(auth, /organization: \{\s*select: \{\s*id: true,\s*status: true,[\s\S]*?moduleSettings: true,/);
  assert.match(auth, /\.\.\.\(disabledModules\.length \? \{ disabledModules \} : \{\}\),/);
});

// --- SUPER_ADMIN ------------------------------------------------------------------

test("only the SUPER_ADMIN can read or change the modules of an organisation", () => {
  const service = read("lib/server/organization-modules.ts");
  assert.match(service, /export async function getOrganizationModules\(organizationId: string\)[\s\S]*?await requireSuperAdmin\(\);/);
  assert.match(service, /export async function updateOrganizationModules\([\s\S]*?const superAdmin = await requireSuperAdmin\(\);/);
  const route = read("app/api/organizations/[id]/modules/route.ts");
  assert.match(route, /export async function PUT\(request: Request, context: RouteContext\) \{\s*const csrfRejection = rejectUntrustedOrigin\(request\);/);
  // no other route writes Organization.moduleSettings
  for (const { route: other, source } of apiRoutes) {
    if (other === "/api/organizations/[id]/modules") continue;
    assert.equal(/moduleSettings/.test(source), false, other);
  }
  assert.equal(/moduleSettings/.test(read("lib/server/organizations.ts")), false, "the organisation form cannot touch the modules");
});
