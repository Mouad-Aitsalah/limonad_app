/**
 * Pages whose text is enlarged x1.3 on desktop (>= lg) for readability.
 *
 * The list is explicit on purpose: only these exact routes are scaled, every
 * other page (POS, driver, login, dashboard, ...) keeps its current sizes.
 * Sub-pages (e.g. /produits/import, /employes/[id]) are NOT included unless
 * they are listed here.
 */
export const DESKTOP_SCALE_ROUTES: readonly string[] = [
  "/ventes", // Archives des factures
  "/ventes/journalieres", // Factures journalières
  "/produits", // Produits
  "/categories", // Catégories
  "/stock", // Stock
  "/achats/nouveau", // Achats
  "/achats", // Historique des achats
  "/comptes", // Comptes
  "/contacts", // Contacts
  "/employes", // Employés
  "/employes/avances-salaire", // Avances / Salaire
  "/comptabilite/reglements-clients", // Règlement clients
  "/comptabilite/solde-clients", // Solde clients
];

export function isDesktopScaleRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const normalized =
    pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return DESKTOP_SCALE_ROUTES.includes(normalized);
}
