/**
 * Customer account number presentation.
 *
 * A customer's stored `Customer.code` is `"3421" + <sequence>` (see
 * lib/server/customers.ts#nextCustomerCode - the sequence comes from the
 * concurrency-safe DocumentSequence counter, never MAX+1). The digits after
 * the fixed "3421" prefix ARE the per-organisation customer counter:
 * "34211" is customer #1, "342115" is customer #15.
 *
 * This module only changes how that code is shown and how a short number
 * typed by an operator is turned back into a real code. Nothing here writes
 * to the database and the stored value is never modified.
 */

export const CUSTOMER_ACCOUNT_PREFIX = "3421";

/**
 * "34211" -> "3421/1", "342115" -> "3421/15". Any code that is not
 * exactly `CUSTOMER_ACCOUNT_PREFIX` followed by 1+ digits (a legacy or
 * hand-entered custom code) is returned unchanged.
 */
export function formatCustomerCode(code: string | null | undefined): string {
  if (!code) return "";
  if (!code.startsWith(CUSTOMER_ACCOUNT_PREFIX)) return code;
  const rest = code.slice(CUSTOMER_ACCOUNT_PREFIX.length);
  if (rest.length === 0 || !/^\d+$/.test(rest)) return code;
  // Drop any accidental leading zeros so "3421/007" never happens, but keep
  // a lone "0".
  const counter = rest.replace(/^0+(?=\d)/, "");
  return `${CUSTOMER_ACCOUNT_PREFIX}/${counter}`;
}

/**
 * Turns whatever an operator typed in the POS "N° client" box into the exact
 * stored code to look up, or null when the input can't be a customer number.
 *
 * Accepted:
 *   "1"            -> "34211"
 *   "15"           -> "342115"
 *   "3421/15"      -> "342115"
 *   "3421 / 15"    -> "342115"
 *   "342115"       -> "342115"  (already a full code)
 *   "  15  "       -> "342115"  (trimmed)
 *
 * Rejected (returns null): empty, non-numeric, negative, a value with a
 * leading zero like "01" (ambiguous), anything with unexpected characters.
 * The caller still scopes the lookup to the current organisation - this
 * function never touches the database.
 */
export function resolveCustomerCodeFromInput(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  // Full "3421/15" or "3421 / 15" form.
  const slash = value.replace(/\s+/g, "");
  const slashMatch = slash.match(
    new RegExp(`^${CUSTOMER_ACCOUNT_PREFIX}\\s*/\\s*(\\d+)$`),
  );
  if (slashMatch) {
    const counter = slashMatch[1];
    if (counter.length > 1 && counter.startsWith("0")) return null;
    return `${CUSTOMER_ACCOUNT_PREFIX}${counter}`;
  }

  // Plain digits.
  if (!/^\d+$/.test(value)) return null;
  if (value.length > 1 && value.startsWith("0")) return null;

  // Already a full code ("3421" + at least one more digit).
  if (value.startsWith(CUSTOMER_ACCOUNT_PREFIX) && value.length > CUSTOMER_ACCOUNT_PREFIX.length) {
    return value;
  }

  return `${CUSTOMER_ACCOUNT_PREFIX}${value}`;
}
