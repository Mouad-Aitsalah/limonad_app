/**
 * PHASE 5A.2 - "17. NAVIGATION CLIENT" (ÉTAPE 19 extension). A plain state
 * machine, no router: STOCK/VENTES/CLIENTS/TOURNEE are the historical
 * driverNavItems entries (components/driver/driver-nav-items.ts) not yet
 * ported to this shell - each renders MigrationPendingScreen for now (see
 * that screen's own doc comment) so the navigation structure itself is
 * already in place and never needs touching again once each real screen is
 * built in a later étape. Still never a navigation to /driver, /driver/pos,
 * /driver/stock, ... (the Next app's own routes - unreachable and
 * irrelevant from this shell's origin).
 */
export type Screen =
  | "HOME"
  | "LOGIN"
  | "OFFLINE_SALES"
  | "POS"
  | "STOCK"
  | "VENTES"
  | "CLIENTS"
  | "TOURNEE"
  // ÉTAPE 26 - "5. LES 6 APPLICATIONS": "Mon camion" (href "/driver" in
  // driverNavItems/MobileLauncher's own appearance override) - same
  // MigrationPendingScreen placeholder pattern as TOURNEE above, business
  // logic deliberately not implemented yet (its own later étape).
  | "CAMION";
