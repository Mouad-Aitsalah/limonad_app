/**
 * Format of the StockMovement numbers ("MV-000171") and the numbers of a block
 * reserved in one go. Framework-free (no `server-only`, no database): shared by
 * lib/server/sales-shared.ts (nextMovementNumber / nextMovementNumbers) and
 * unit-tested without a database.
 *
 * The ONLY source of these numbers is the DocumentSequence counter
 * (documentType STOCK_MOVEMENT, scopeKey ""), advanced atomically by
 * reserveDocumentSequence (one number: sales, loadings, purchases, ...) or
 * reserveDocumentSequenceBlock (N consecutive numbers: an inventory that
 * adjusts N products). Counting the existing rows (`count() + 1`) never advanced
 * that counter and made the next counter-based sale collide with the inventory's
 * numbers on @@unique([organizationId, movementNumber]).
 */

export function formatMovementNumber(sequence: number): string {
  return `MV-${String(sequence).padStart(6, "0")}`;
}

/**
 * The `size` consecutive numbers of a block whose FIRST value is `first`
 * (what reserveDocumentSequenceBlock returns): first, first + 1, ...
 */
export function movementNumbersOfBlock(first: number, size: number): string[] {
  if (!Number.isInteger(first) || first < 1) {
    throw new Error("Le premier numero du bloc doit etre un entier positif.");
  }
  if (!Number.isInteger(size) || size < 0) {
    throw new Error("La taille du bloc doit etre un entier positif ou nul.");
  }
  return Array.from({ length: size }, (_, index) => formatMovementNumber(first + index));
}
