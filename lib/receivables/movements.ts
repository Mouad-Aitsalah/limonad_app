import type { ReceivableMovementDto, ReceivableMovementKind } from "@/types/receivables";

/**
 * The movements of one customer's account as the receivables formula sees them
 * (credit sales +, validated credit notes -, validated settlements -), oldest
 * first, with the running balance after each one. The last running balance is
 * therefore exactly creditSales - creditNotes - settlements, the unclamped
 * balance behind the figure of the table - pure.
 */

export type MovementInput = Omit<ReceivableMovementDto, "balance"> & {
  /** Instant used to order movements of the same business day (ms). */
  sortAt: number;
};

const KIND_ORDER: Record<ReceivableMovementKind, number> = { OPENING: -1, CREDIT_SALE: 0, CREDIT_NOTE: 1, SETTLEMENT: 2 };

export function compareMovements(a: MovementInput, b: MovementInput): number {
  return (
    a.day.localeCompare(b.day) ||
    a.sortAt - b.sortAt ||
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Orders the movements, computes the running balance in cents, and - for very
 * long histories - keeps the `maxRows` most recent ones behind an OPENING line
 * that carries the balance of everything before (so every balance shown stays
 * the true one).
 */
export function buildMovements(inputs: readonly MovementInput[], maxRows = 500): { movements: ReceivableMovementDto[]; truncated: boolean; finalBalance: number } {
  const sorted = [...inputs].sort(compareMovements);
  let cents = 0;
  const withBalance: ReceivableMovementDto[] = sorted.map((input) => {
    const movement: Omit<ReceivableMovementDto, "balance"> & { sortAt?: number } = { ...input };
    delete movement.sortAt; // ordering only - never sent to the browser
    cents += Math.round(movement.amount * 100);
    return { ...movement, balance: cents / 100 };
  });
  const finalBalance = cents / 100;
  if (withBalance.length <= maxRows) return { movements: withBalance, truncated: false, finalBalance };

  const kept = withBalance.slice(withBalance.length - maxRows);
  const before = withBalance[withBalance.length - maxRows - 1];
  const opening: ReceivableMovementDto = {
    id: "opening",
    kind: "OPENING",
    day: before.day,
    reference: "",
    label: `Solde des ${withBalance.length - maxRows} mouvements antérieurs`,
    amount: before.balance,
    balance: before.balance,
  };
  return { movements: [opening, ...kept], truncated: true, finalBalance };
}
