import type { ModuleKey } from "@/lib/modules/registry";

/**
 * API routes -> modules: the explicit correspondence between every route under
 * app/api and the module(s) it serves (a test walks app/api and fails if a
 * route or one of its methods is not covered here).
 *
 * - `modules`: the route is served when AT LEAST ONE of them is enabled for the
 *   caller's organisation (a route shared by several modules, e.g. an invoice's
 *   detail read by the POS, the archives and the daily invoices, keeps working
 *   while one of them is enabled). Enforced by rejectDisabledModule() at the
 *   top of the route handler (lib/server/module-guard.ts).
 * - `essential`: not tied to a module, always available (login, session,
 *   account, SUPER_ADMIN space, catalogue, settings...). The reason is written
 *   down so the choice stays explicit.
 * - `auth`: routes NOT authenticated by a staff session check their module
 *   themselves, against the organisation of their own credential: "client"
 *   (Espace client session, lib/server/client-auth.ts) and "trackingToken"
 *   (signed GPS token of the native background tracking).
 *
 * `path` uses the app/api folder names: "[id]" matches one segment, a final
 * "**" any number of segments. The most specific rule wins; a rule with
 * `methods` only applies to those HTTP methods. Pure module.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ApiModuleRule = {
  path: string;
  methods?: readonly HttpMethod[];
} & (
  | { modules: readonly ModuleKey[]; essential?: undefined; auth?: "client" | "trackingToken" }
  | { essential: string; modules?: undefined; auth?: undefined }
);

export const API_MODULE_RULES: readonly ApiModuleRule[] = [
  // --- Always available --------------------------------------------------
  { path: "/api/auth/**", essential: "Connexion, déconnexion, session et activité" },
  { path: "/api/mobile/auth/**", essential: "Connexion de l'application chauffeur" },
  { path: "/api/organizations/**", essential: "Espace SUPER_ADMIN (organisations, connexions, modules)" },
  { path: "/api/organization/**", essential: "Paramètres et identité de l'entreprise (module essentiel)" },
  { path: "/api/table-preferences", essential: "Préférences d'affichage de l'utilisateur" },
  { path: "/api/cron/**", essential: "Tâche planifiée protégée par secret, sans session utilisateur" },
  { path: "/api/products/**", essential: "Catalogue produits (module essentiel)" },
  { path: "/api/categories/**", essential: "Catégories (module essentiel)" },
  { path: "/api/brands", essential: "Marques du catalogue (module essentiel)" },
  { path: "/api/produits/**", essential: "Import / export du catalogue (module essentiel)" },
  { path: "/api/suppliers/[id]/logo", methods: ["GET"], essential: "Image du logo fournisseur (catalogue, caisse)" },

  // --- Dashboard ---------------------------------------------------------
  { path: "/api/dashboard/**", modules: ["dashboard"] },

  // --- Point de vente ----------------------------------------------------
  { path: "/api/sales", methods: ["POST"], modules: ["pos"] },
  { path: "/api/sales", methods: ["GET"], modules: ["pos", "salesArchive", "dailyInvoices"] },
  { path: "/api/sales/context", modules: ["pos"] },
  { path: "/api/sales/pending", modules: ["pos"] },
  { path: "/api/sales/reserve-number", modules: ["pos"] },
  { path: "/api/sales/sync", modules: ["pos"] },
  { path: "/api/sales/[id]", methods: ["GET"], modules: ["pos", "salesArchive", "dailyInvoices"] },
  { path: "/api/sales/[id]", methods: ["PATCH"], modules: ["pos"] },
  { path: "/api/sales/[id]/collect", modules: ["pos"] },
  { path: "/api/sales/[id]/cancel", modules: ["salesArchive", "dailyInvoices"] },
  { path: "/api/pos/**", modules: ["pos"] },
  { path: "/api/products/pos-by-ids", modules: ["pos"] },

  // --- Versements, archives, factures journalières ---------------------
  { path: "/api/cash-deposits/**", modules: ["deposits"] },
  { path: "/api/sales-history", modules: ["salesArchive"] },
  { path: "/api/daily-invoices", modules: ["dailyInvoices"] },
  { path: "/api/daily-invoices/sales-grouping", modules: ["dailyInvoices"] },

  // --- Commandes en ligne + Espace client ------------------------------
  { path: "/api/customer-orders/**", modules: ["customerOrders"] },
  { path: "/api/client/**", modules: ["customerOrders"], auth: "client" },

  // --- Avoirs ------------------------------------------------------------
  { path: "/api/credit-notes/**", modules: ["creditNotes"] },

  // --- Stock, inventaire, transferts, camions --------------------------
  { path: "/api/stock", modules: ["stock"] },
  { path: "/api/stock/adjustments", modules: ["stock"] },
  { path: "/api/stock/movements/**", modules: ["stock"] },
  { path: "/api/stock/products/**", modules: ["stock"] },
  // read by the counter POS offline synchronisation as well
  { path: "/api/stock/locations/**", modules: ["stock", "pos"] },
  { path: "/api/stock/depot/[depotId]", modules: ["stock", "inventory", "stockTransfers"] },
  { path: "/api/stock/truck/[truckId]", modules: ["stock", "stockTransfers"] },
  // the depot list also feeds the user forms (depot assignment)
  { path: "/api/depots", methods: ["GET"], modules: ["stock", "users"] },
  { path: "/api/depots", methods: ["POST"], modules: ["stock"] },
  { path: "/api/depots/[id]", modules: ["stock", "users"] },
  { path: "/api/inventories/**", modules: ["inventory"] },
  { path: "/api/truck-loadings/**", modules: ["stockTransfers"] },
  { path: "/api/tours/**", modules: ["stockTransfers"] },
  // the truck list also feeds the user forms (driver truck)
  { path: "/api/trucks", methods: ["GET"], modules: ["trucks", "users"] },
  { path: "/api/trucks", methods: ["POST"], modules: ["trucks"] },
  // one truck is also read by the live fleet map
  { path: "/api/trucks/[id]", methods: ["GET"], modules: ["trucks", "gps"] },
  { path: "/api/trucks/[id]", methods: ["PATCH"], modules: ["trucks"] },
  { path: "/api/trucks/[id]/status", modules: ["trucks"] },

  // --- Suivi GPS et circuits -------------------------------------------
  { path: "/api/trucks/live", modules: ["gps"] },
  { path: "/api/maps/route", modules: ["gps"] },
  { path: "/api/driver/tour/location", modules: ["gps"] },
  { path: "/api/driver/tour/location-token", modules: ["gps"] },
  { path: "/api/driver/tour/location/batch", modules: ["gps"], auth: "trackingToken" },
  { path: "/api/driver/tour/location/native", modules: ["gps"], auth: "trackingToken" },

  // --- Achats --------------------------------------------------------------
  { path: "/api/purchases", modules: ["purchases"] },
  { path: "/api/suppliers", modules: ["purchases", "accounts"] },

  // --- Comptes, contacts -------------------------------------------------
  { path: "/api/comptes/**", modules: ["accounts"] },
  { path: "/api/suppliers/[id]/logo", methods: ["PUT"], modules: ["accounts"] },
  // the customer list is also read by the POS offline sync and the settlements
  { path: "/api/customers", methods: ["GET"], modules: ["accounts", "pos", "accounting"] },
  { path: "/api/customers", methods: ["POST"], modules: ["accounts"] },
  // customer lookups of the POS, the driver app and the settlements screen
  { path: "/api/customers/[id]", methods: ["GET"], modules: ["accounts", "pos", "driverApp", "accounting"] },
  { path: "/api/customers/[id]", methods: ["PATCH"], modules: ["accounts"] },
  { path: "/api/customers/[id]/status", modules: ["accounts"] },
  { path: "/api/customers/search", modules: ["accounts", "pos", "driverApp", "accounting"] },
  { path: "/api/customers/by-number", modules: ["accounts", "pos", "driverApp", "accounting"] },
  { path: "/api/contacts/**", modules: ["contacts"] },

  // --- Employés, comptabilité ------------------------------------------
  { path: "/api/employees/**", modules: ["employees"] },
  { path: "/api/accounting/**", modules: ["accounting"] },
  // the chart of accounts is also read by the purchase form (payment account)
  { path: "/api/accounting/accounts", methods: ["GET"], modules: ["accounting", "purchases"] },
  { path: "/api/customer-balances", modules: ["accounting"] },
  { path: "/api/customers/[id]/journal", modules: ["accounting"] },
  { path: "/api/customers/[id]/settlements", modules: ["accounting"] },

  // --- Utilisateurs, assistant -----------------------------------------
  { path: "/api/users/**", modules: ["users"] },
  { path: "/api/drivers/[id]/truck", modules: ["users"] },
  { path: "/api/ai/**", modules: ["assistant"] },
  { path: "/api/assistant/**", modules: ["assistant"] },

  // --- Application chauffeur -------------------------------------------
  { path: "/api/driver/**", modules: ["driverApp"] },
];

function splitPath(path: string) {
  return path.split("?")[0].replace(/\/+$/, "").split("/").filter(Boolean);
}

/** Specificity score of a rule that matches `segments`, or -1 when it does not match. */
function matchScore(rule: ApiModuleRule, segments: string[]): number {
  const pattern = splitPath(rule.path);
  const glob = pattern[pattern.length - 1] === "**";
  const fixed = glob ? pattern.slice(0, -1) : pattern;
  if (glob ? segments.length < fixed.length : segments.length !== fixed.length) return -1;
  let literals = 0;
  for (let index = 0; index < fixed.length; index += 1) {
    const part = fixed[index];
    if (/^\[[^\]]+\]$/.test(part)) continue;
    if (part !== segments[index]) return -1;
    literals += 1;
  }
  // exact patterns beat "**" ones; then more literal segments; then a method-specific rule
  return (glob ? 0 : 10_000) + literals * 100 + fixed.length * 10 + (rule.methods ? 1 : 0);
}

/** The rule that applies to a request, or null when the route is not mapped. */
export function resolveApiModuleRule(pathname: string, method: string): ApiModuleRule | null {
  const segments = splitPath(pathname);
  const upper = method.toUpperCase();
  let best: { rule: ApiModuleRule; score: number } | null = null;
  for (const rule of API_MODULE_RULES) {
    if (rule.methods && !rule.methods.includes(upper as HttpMethod)) continue;
    const score = matchScore(rule, segments);
    if (score >= 0 && (!best || score > best.score)) best = { rule, score };
  }
  return best?.rule ?? null;
}
