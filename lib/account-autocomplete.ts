/**
 * Autocomplete rules for the "N° compte" field of Comptabilite -> Ecriture
 * comptable. Pure (no React, no server code) so the behaviour is unit-tested;
 * components/accounting/account-code-input.tsx only wires it to the DOM.
 *
 * Source of the accounts: the chart of accounts the page already loads once
 * (listAccountingAccountOptions) - suggestions are filtered in memory, no
 * request is made while typing.
 */

/** Suggestions shown at once; the user narrows the list by typing more digits. */
export const ACCOUNT_SUGGESTION_LIMIT = 20;

export type SuggestableAccount = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

function normalize(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * Active accounts whose NUMBER STARTS WITH what was typed (never "contains":
 * typing 51 does not suggest 4511 or 1051). Sorted by number, de-duplicated by
 * id, truncated to `limit`; `total` is the untruncated match count. An empty
 * input suggests nothing. Inactive accounts are not suggested (the entry form
 * rejects them anyway).
 */
export function filterAccountsByPrefix<T extends SuggestableAccount>(
  accounts: readonly T[],
  input: string,
  limit: number = ACCOUNT_SUGGESTION_LIMIT,
): { items: T[]; total: number } {
  const query = normalize(input);
  if (!query) return { items: [], total: 0 };

  const seen = new Set<string>();
  const matches: T[] = [];
  for (const account of accounts) {
    if (!account.isActive || seen.has(account.id)) continue;
    if (!normalize(account.code).startsWith(query)) continue;
    seen.add(account.id);
    matches.push(account);
  }
  matches.sort((a, b) => (normalize(a.code) < normalize(b.code) ? -1 : normalize(a.code) > normalize(b.code) ? 1 : 0));
  return { items: matches.slice(0, Math.max(0, limit)), total: matches.length };
}

/** Index of the suggestion whose number equals the typed one, or -1. */
export function findExactAccountIndex(items: readonly SuggestableAccount[], input: string): number {
  const query = normalize(input);
  if (!query) return -1;
  return items.findIndex((account) => normalize(account.code) === query);
}

export type AutocompleteState = {
  open: boolean;
  /** Highlighted suggestion, -1 = none. */
  activeIndex: number;
};

export const CLOSED_AUTOCOMPLETE: AutocompleteState = { open: false, activeIndex: -1 };

/**
 * After the user edits the text: the list opens while there is text; a
 * suggestion is pre-highlighted only when it is EXACTLY the typed number, so
 * a plain Enter on a partial number never grabs a suggestion by surprise.
 */
export function autocompleteAfterInput(hasText: boolean, exactIndex: number): AutocompleteState {
  return hasText ? { open: true, activeIndex: exactIndex } : CLOSED_AUTOCOMPLETE;
}

export type AutocompleteKeyResult = {
  state: AutocompleteState;
  /** true = the key was used by the autocomplete (caller must preventDefault, not forward it). */
  consumed: boolean;
  /** true = choose the suggestion at `state`'s previous activeIndex. */
  select: boolean;
};

/**
 * Keyboard behaviour. Enter selects the ACTIVE suggestion; with no active
 * suggestion (or no list) it is NOT consumed, so the existing "Enter moves to
 * the next field" navigation keeps working. Escape closes the list. Arrows
 * move the highlight (wrapping) and reopen a closed list.
 */
export function handleAutocompleteKey(
  state: AutocompleteState,
  key: string,
  resultCount: number,
): AutocompleteKeyResult {
  const listVisible = state.open && resultCount > 0;

  if (key === "Escape") {
    return state.open
      ? { state: CLOSED_AUTOCOMPLETE, consumed: true, select: false }
      : { state, consumed: false, select: false };
  }

  if (key === "ArrowDown" || key === "ArrowUp") {
    if (resultCount === 0) return { state, consumed: false, select: false };
    if (!listVisible) {
      return {
        state: { open: true, activeIndex: key === "ArrowDown" ? 0 : resultCount - 1 },
        consumed: true,
        select: false,
      };
    }
    const current = state.activeIndex;
    const next =
      key === "ArrowDown"
        ? current >= resultCount - 1 ? 0 : current + 1
        : current <= 0 ? resultCount - 1 : current - 1;
    return { state: { open: true, activeIndex: next }, consumed: true, select: false };
  }

  if (key === "Enter") {
    if (listVisible && state.activeIndex >= 0 && state.activeIndex < resultCount) {
      return { state: CLOSED_AUTOCOMPLETE, consumed: true, select: true };
    }
    // No active suggestion: let Enter move on, but close the list.
    return { state: CLOSED_AUTOCOMPLETE, consumed: false, select: false };
  }

  if (key === "Tab") {
    return { state: CLOSED_AUTOCOMPLETE, consumed: false, select: false };
  }

  return { state, consumed: false, select: false };
}
