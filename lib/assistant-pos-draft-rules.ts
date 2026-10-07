import { z } from "zod";

/**
 * AI assistant -> POS cart ("AiPosDraft") - the PURE rules, no database and
 * no server-only import, so they are unit-tested directly.
 *
 * A draft line is only { productId, quantity }: never a price, total, VAT or
 * discount. The POS recomputes all of that itself from its own catalogue when
 * the draft is opened (components/pos/pos-layout.tsx -> cartLines).
 */

export const AI_POS_DRAFT_TTL_MINUTES = 60;
export const AI_POS_DRAFT_MAX_LINES = 50;
export const AI_POS_DRAFT_MAX_QUANTITY = 10_000;
export const AI_POS_DRAFT_MAX_CANDIDATES = 5;

export type AiPosDraftLine = { productId: string; quantity: number };

export const aiPosDraftLinesSchema = z
  .array(
    z
      .object({
        productId: z.string().trim().min(1).max(64),
        quantity: z.number().int().positive().max(AI_POS_DRAFT_MAX_QUANTITY),
      })
      .strict(),
  )
  .max(AI_POS_DRAFT_MAX_LINES);

/** Reads the `lines` JSON column back. Anything malformed is an empty draft, never a crash. */
export function parseAiPosDraftLines(value: unknown): AiPosDraftLine[] {
  const parsed = aiPosDraftLinesSchema.safeParse(value);
  return parsed.success ? mergeAiPosDraftLines(parsed.data) : [];
}

/** One line per product (quantities summed), first-seen order kept. */
export function mergeAiPosDraftLines(lines: AiPosDraftLine[]): AiPosDraftLine[] {
  const byId = new Map<string, number>();
  for (const line of lines) byId.set(line.productId, (byId.get(line.productId) ?? 0) + line.quantity);
  return [...byId].map(([productId, quantity]) => ({
    productId,
    quantity: Math.min(quantity, AI_POS_DRAFT_MAX_QUANTITY),
  }));
}

// ---------------------------------------------------------------------------
// Text normalisation
// ---------------------------------------------------------------------------

/**
 * Case, accents, apostrophes, punctuation and extra spaces never matter:
 * "Hawaï" / "HAWAI" / "hawai" -> "hawai", "Pom's" / "poms" -> "poms",
 * "Coca-Cola  1.5L" -> "coca cola 1 5l".
 */
export function normalizeMatchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’‘`´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** normalizeMatchText without any space: "coca cola" and "cocacola" compare equal. */
export function compactMatchText(value: string): string {
  return normalizeMatchText(value).replace(/ /g, "");
}

/**
 * A short, accent-free prefix of the query used to fetch candidates from the
 * database (a plain SQL `contains` is accent-sensitive: "hawai" never finds
 * "Hawaï", but "haw" does). Null when the query is too short to be useful.
 */
export function candidateProbe(query: string): string | null {
  const firstToken = normalizeMatchText(query).split(" ")[0] ?? "";
  if (firstToken.length < 3) return null;
  return firstToken.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Product resolution
// ---------------------------------------------------------------------------

export type ProductCandidate = {
  id: string;
  name: string;
  reference: string;
  barcode?: string | null;
};

export type Resolution<T> =
  | { kind: "unique"; item: T }
  | { kind: "ambiguous"; candidates: T[] }
  | { kind: "none" };

function uniqueOrAmbiguous<T>(matches: T[]): Resolution<T> | null {
  if (matches.length === 1) return { kind: "unique", item: matches[0] };
  if (matches.length > 1) return { kind: "ambiguous", candidates: matches.slice(0, AI_POS_DRAFT_MAX_CANDIDATES) };
  return null;
}

/** Every query word is found in the text (word prefix or inside the compact text). */
function containsAllTokens(text: string, query: string): boolean {
  const normalizedText = normalizeMatchText(text);
  const compactText = normalizedText.replace(/ /g, "");
  const words = normalizedText.split(" ");
  const tokens = normalizeMatchText(query).split(" ").filter(Boolean);
  if (tokens.length === 0) return false;
  if (compactText.includes(tokens.join(""))) return true;
  return tokens.every((token) => words.some((word) => word.startsWith(token)) || compactText.includes(token));
}

function matchScore(name: string, query: string): number {
  const text = compactMatchText(name);
  const compactQuery = compactMatchText(query);
  if (text.startsWith(compactQuery)) return 0;
  if (normalizeMatchText(name).split(" ").some((word) => word.startsWith(normalizeMatchText(query)))) return 1;
  return 2;
}

function sortByRelevance<T extends { name: string }>(items: T[], query: string): T[] {
  return [...items].sort(
    (a, b) =>
      matchScore(a.name, query) - matchScore(b.name, query) ||
      a.name.length - b.name.length ||
      a.name.localeCompare(b.name, "fr"),
  );
}

/**
 * Picks the product a text query designates, among candidates already scoped
 * to the organisation and ACTIVE by the caller. Order of trust:
 *   1. exact barcode, 2. exact reference, 3. exact normalised name,
 *   4. normalised "contains" search.
 * A step that finds exactly one product wins; several -> "ambiguous" (at
 * most 5 candidates, the user must choose - never an arbitrary pick); none at
 * every step -> "none". A trailing plural "s" is retried ("cocas" -> "coca").
 */
export function resolveProductCandidates<T extends ProductCandidate>(
  query: string,
  candidates: T[],
): Resolution<T> {
  const raw = query.trim();
  if (!raw) return { kind: "none" };

  const byBarcode = uniqueOrAmbiguous(candidates.filter((item) => item.barcode && item.barcode === raw));
  if (byBarcode) return byBarcode;

  const compactQuery = compactMatchText(raw);
  if (!compactQuery) return { kind: "none" };

  const byReference = uniqueOrAmbiguous(
    candidates.filter((item) => compactMatchText(item.reference) === compactQuery),
  );
  if (byReference) return byReference;

  const byName = uniqueOrAmbiguous(candidates.filter((item) => compactMatchText(item.name) === compactQuery));
  if (byName) return byName;

  const contains = (q: string) =>
    candidates.filter((item) => containsAllTokens(item.name, q) || containsAllTokens(item.reference, q));
  let matches = contains(raw);
  if (matches.length === 0 && compactQuery.length > 3 && compactQuery.endsWith("s")) {
    matches = contains(raw.replace(/s\s*$/i, ""));
  }
  return uniqueOrAmbiguous(sortByRelevance(matches, raw)) ?? { kind: "none" };
}

// ---------------------------------------------------------------------------
// Customer resolution
// ---------------------------------------------------------------------------

export type CustomerCandidate = {
  id: string;
  name: string;
  code: string;
  displayCode: string;
};

/** "44115", "3421/15", "15": a customer NUMBER, resolved by the POS "N° client" rule first. */
export function looksLikeCustomerNumber(query: string): boolean {
  return /^\d+(\s*\/\s*\d+)?$/.test(query.trim());
}

/**
 * Same idea as the product resolution, for customers already scoped to the
 * organisation and ACTIVE: exact code / displayed number, then exact
 * normalised name, then "contains". Never creates anything.
 */
export function resolveCustomerCandidates<T extends CustomerCandidate>(
  query: string,
  candidates: T[],
): Resolution<T> {
  const compactQuery = compactMatchText(query);
  if (!compactQuery) return { kind: "none" };

  const byCode = uniqueOrAmbiguous(
    candidates.filter(
      (item) => compactMatchText(item.code) === compactQuery || compactMatchText(item.displayCode) === compactQuery,
    ),
  );
  if (byCode) return byCode;

  const byName = uniqueOrAmbiguous(candidates.filter((item) => compactMatchText(item.name) === compactQuery));
  if (byName) return byName;

  const matches = candidates.filter((item) => containsAllTokens(item.name, query));
  return uniqueOrAmbiguous(sortByRelevance(matches, query)) ?? { kind: "none" };
}

// ---------------------------------------------------------------------------
// Operations on the draft lines
// ---------------------------------------------------------------------------

export type AiPosDraftLineAction = "add" | "decrease" | "remove" | "set";

export type AiPosDraftLineOperation = {
  action: AiPosDraftLineAction;
  productId: string;
  /** add / set: required (>= 1). decrease: defaults to 1. remove: ignored. */
  quantity?: number;
};

export type ApplyOperationsResult =
  | { ok: true; lines: AiPosDraftLine[] }
  | { ok: false; error: "PRODUCT_NOT_IN_DRAFT" | "INVALID_QUANTITY" | "TOO_MANY_LINES"; productId?: string };

/**
 * Applies the user's edit commands to the CURRENT draft lines (read from the
 * database by the caller - the model never sends the cart state):
 *   add      "zid 2 coca"       -> +2 (new line if absent)
 *   decrease "na9es wa7ed coca" -> -1 (line removed when it reaches 0)
 *   remove   "7yed poms"        -> line removed
 *   set      "dir 5 coca"       -> quantity becomes 5
 * Pure: returns a new array, never mutates the input. All-or-nothing.
 */
export function applyAiPosDraftOperations(
  current: AiPosDraftLine[],
  operations: AiPosDraftLineOperation[],
): ApplyOperationsResult {
  const lines = new Map(mergeAiPosDraftLines(current).map((line) => [line.productId, line.quantity]));
  const validQuantity = (value: number | undefined) =>
    value !== undefined && Number.isInteger(value) && value >= 1 && value <= AI_POS_DRAFT_MAX_QUANTITY;

  for (const operation of operations) {
    const existing = lines.get(operation.productId);
    if (operation.action === "add" || operation.action === "set") {
      if (!validQuantity(operation.quantity)) {
        return { ok: false, error: "INVALID_QUANTITY", productId: operation.productId };
      }
      const next = operation.action === "add" ? (existing ?? 0) + operation.quantity! : operation.quantity!;
      lines.set(operation.productId, Math.min(next, AI_POS_DRAFT_MAX_QUANTITY));
      continue;
    }
    if (existing === undefined) {
      return { ok: false, error: "PRODUCT_NOT_IN_DRAFT", productId: operation.productId };
    }
    if (operation.action === "remove") {
      lines.delete(operation.productId);
      continue;
    }
    const step = operation.quantity ?? 1;
    if (!validQuantity(step)) return { ok: false, error: "INVALID_QUANTITY", productId: operation.productId };
    if (existing - step <= 0) lines.delete(operation.productId);
    else lines.set(operation.productId, existing - step);
  }

  if (lines.size > AI_POS_DRAFT_MAX_LINES) return { ok: false, error: "TOO_MANY_LINES" };
  return { ok: true, lines: [...lines].map(([productId, quantity]) => ({ productId, quantity })) };
}

/** Requested quantity above what the depot has: a warning only - the counter POS allows negative stock. */
export function stockWarning(productName: string, requested: number, available: number | null): string | null {
  if (available === null || requested <= available) return null;
  const left = available <= 0 ? "Il n'en reste plus en stock" : `Il reste seulement ${available} ${productName}`;
  return `⚠️ ${left}, mais tu demandes ${requested} unité${requested > 1 ? "s" : ""}. Le POS autorise actuellement cette vente.`;
}

export function aiPosDraftExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + AI_POS_DRAFT_TTL_MINUTES * 60_000);
}

export function isAiPosDraftExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

export type AiPosDraftAccessRow = {
  organizationId: string;
  userId: string;
  status: "OPEN" | "APPLIED" | "EXPIRED";
  expiresAt: Date;
};

export type AiPosDraftAccess =
  | { ok: true }
  | { ok: false; reason: "NOT_FOUND" | "ALREADY_APPLIED" | "EXPIRED"; status: 404 | 409 | 410; message: string };

/**
 * May this session open this draft in the POS? Only its own author, in the
 * same organisation (anything else answers "not found", never revealing that
 * the draft exists), only while OPEN and not expired.
 */
export function checkAiPosDraftAccess(
  row: AiPosDraftAccessRow | null,
  viewer: { organizationId: string; userId: string },
  now: Date = new Date(),
): AiPosDraftAccess {
  if (!row || row.organizationId !== viewer.organizationId || row.userId !== viewer.userId) {
    return { ok: false, reason: "NOT_FOUND", status: 404, message: "Panier préparé introuvable." };
  }
  if (row.status === "APPLIED") {
    return {
      ok: false,
      reason: "ALREADY_APPLIED",
      status: 409,
      message: "Ce panier préparé a déjà été ouvert dans le POS.",
    };
  }
  if (row.status === "EXPIRED" || isAiPosDraftExpired(row.expiresAt, now)) {
    return {
      ok: false,
      reason: "EXPIRED",
      status: 410,
      message: "Ce panier préparé a expiré. Demande à l'Assistant IA d'en préparer un nouveau.",
    };
  }
  return { ok: true };
}

/** The POS link for a draft - same tab, opened by the "Ouvrir le panier" button. */
export function aiPosDraftHref(draftId: string): string {
  return `/pos?aiDraft=${encodeURIComponent(draftId)}`;
}

export const AI_POS_DRAFT_LINK_LABEL = "🛒 Ouvrir le panier";

/** Recognises exactly the links built by aiPosDraftHref (relative, POS, one id). */
export function parseAiPosDraftHref(href: string | undefined | null): string | null {
  if (!href) return null;
  const match = /^\/pos\?aiDraft=([A-Za-z0-9_-]{1,64})$/.exec(href);
  return match ? match[1] : null;
}
