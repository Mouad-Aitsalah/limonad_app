/**
 * Business decision: a DRIVER has no access to the goods-return feature - not to
 * create a return (POST /api/driver/returns, createDriverReturn), not to read
 * what can be returned (GET /api/credit-notes/returnables), not to list, open,
 * validate or reverse a credit note. Returns are handled from the desk by the
 * admin, the depot manager and the cashier.
 *
 * This switch closes the creation path for every caller. Nothing is deleted:
 * the historical driver returns stay in the database, stay readable and
 * reversible by the desk roles, and the tour stock sheet keeps counting them.
 */
export const DRIVER_GOODS_RETURNS_ENABLED: boolean = false;

export const DRIVER_GOODS_RETURNS_DISABLED_MESSAGE =
  "Le retour de marchandises n'est pas disponible pour les chauffeurs.";
