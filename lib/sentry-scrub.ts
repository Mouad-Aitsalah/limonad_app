/**
 * Centralised, isomorphic PII / secret scrubbing for every Sentry `beforeSend`
 * (client, server, edge). Enforces the policy in PHASE-4Q.3.
 *
 * Strategy:
 *  1. Drop wholesale the request envelope that can carry credentials / PII
 *     (headers, cookies, body, query string, env).
 *  2. Reduce `user` to an opaque id only (no email / username / ip).
 *  3. Drop infrastructure identifiers (server_name).
 *  4. Deep-walk everything that remains and redact any string matching a
 *     secret / PII pattern (connection string, bearer token, session cookie,
 *     Google key, Neon endpoint id, opaque token.sig, email, MA phone, GPS
 *     coordinate), and redact by key name (authorization, cookie, password…).
 *
 * Never throws. If scrubbing itself fails we return `null` so an un-scrubbed
 * event is never sent.
 */
import type { ErrorEvent } from "@sentry/nextjs";

const REDACTED = "[redacted]";
const MAX_DEPTH = 4;
const MAX_ARRAY = 50;
const MAX_STRING = 8192;

/** Redact any object property whose key looks sensitive, regardless of value. */
const DENY_KEYS = new Set([
  "authorization",
  "cookie",
  "cookies",
  "set-cookie",
  "x-csrf-token",
  "csrf",
  "csrftoken",
  "password",
  "passwd",
  "pwd",
  "token",
  "accesstoken",
  "refreshtoken",
  "session",
  "sessiontoken",
  "secret",
  "clientsecret",
  "dsn",
  "apikey",
  "api_key",
  "database_url",
  "direct_url",
  "connectionstring",
  "email",
  "phone",
  "telephone",
  "address",
  "latitude",
  "longitude",
  "lat",
  "lng",
]);

const RULES: Array<{ re: RegExp; replacement: string }> = [
  // Postgres connection strings (DATABASE_URL / DIRECT_URL)
  { re: /postgres(?:ql)?:\/\/[^\s"'<>]+/gi, replacement: REDACTED },
  // Authorization bearer tokens
  { re: /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, replacement: `Bearer ${REDACTED}` },
  // Session cookie value
  { re: /comdis\.session=[^;\s"']+/gi, replacement: `comdis.session=${REDACTED}` },
  // Google Maps / API keys (real keys are AIza + 35 chars; match 30+ and any
  // over-long malformed variant, no trailing word-boundary requirement)
  { re: /AIza[0-9A-Za-z_-]{30,}/g, replacement: REDACTED },
  // Known Neon endpoint identifiers (prod + dev)
  {
    re: /\bep-(?:old-block-aebwqtri|patient-paper-aehyejmz)[a-z0-9-]*/gi,
    replacement: REDACTED,
  },
  // Opaque token.sig shapes (background tracking token, raw session token)
  { re: /\b[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}=*\b/g, replacement: REDACTED },
  // Email addresses
  {
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replacement: REDACTED,
  },
  // Moroccan phone numbers: +212 / 00212 / 0, then 5/6/7, then 8 digits,
  // with loose separators. No leading \b (it cannot anchor before "+").
  {
    re: /(?:\+212|00212|0)[\s.-]?[5-7](?:[\s.-]?\d){8}(?!\d)/g,
    replacement: REDACTED,
  },
  // GPS coordinates in "key: value" / "key=value" form (keep the key, drop the number)
  {
    re: /("?(?:latitude|longitude|lat|lng)"?\s*[:=]\s*)-?\d{1,3}\.\d{3,}/gi,
    replacement: `$1${REDACTED}`,
  },
];

function applyRules(input: string): string {
  let value = input;
  if (value.length > MAX_STRING) value = `${value.slice(0, MAX_STRING)}…`;
  for (const { re, replacement } of RULES) {
    value = value.replace(re, replacement);
  }
  return value;
}

function scrubValue(value: unknown, depth: number): unknown {
  if (value == null) return value;
  if (typeof value === "string") return applyRules(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= MAX_DEPTH) return REDACTED;

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((item) => scrubValue(item, depth + 1));
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = DENY_KEYS.has(key.toLowerCase())
        ? REDACTED
        : scrubValue(val, depth + 1);
    }
    return out;
  }

  return REDACTED;
}

function isNoisyBreadcrumb(breadcrumb: { category?: string; data?: Record<string, unknown> }): boolean {
  if (breadcrumb.category !== "http" && breadcrumb.category !== "fetch" && breadcrumb.category !== "xhr") {
    return false;
  }
  const url = typeof breadcrumb.data?.url === "string" ? breadcrumb.data.url : "";
  return url.includes("/api/driver/tour/location");
}

/**
 * Sentry `beforeSend` hook. Mutates and returns the event, or `null` to drop.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent | null {
  try {
    // 1. request envelope
    if (event.request) {
      const request = event.request as Record<string, unknown>;
      delete request.headers;
      delete request.cookies;
      delete request.data;
      delete request.env;
      delete request.query_string;
      if (typeof request.url === "string") {
        const q = request.url.indexOf("?");
        if (q >= 0) request.url = request.url.slice(0, q);
      }
    }

    // 2. user -> id only
    if (event.user) {
      const id =
        typeof event.user.id === "string" || typeof event.user.id === "number"
          ? event.user.id
          : undefined;
      if (id === undefined) {
        delete event.user;
      } else {
        event.user = { id };
      }
    }

    // 3. infra identifiers
    delete event.server_name;

    // 4. deep scrub what remains
    if (event.contexts) {
      event.contexts = scrubValue(event.contexts, 0) as ErrorEvent["contexts"];
    }
    if (event.extra) {
      event.extra = scrubValue(event.extra, 0) as ErrorEvent["extra"];
    }
    if (event.tags) {
      event.tags = scrubValue(event.tags, 0) as ErrorEvent["tags"];
    }
    if (Array.isArray(event.breadcrumbs)) {
      event.breadcrumbs = event.breadcrumbs
        .filter((b) => !isNoisyBreadcrumb(b as { category?: string; data?: Record<string, unknown> }))
        .map((b) => scrubValue(b, 0) as (typeof event.breadcrumbs)[number]);
    }
    if (typeof event.message === "string") {
      event.message = applyRules(event.message);
    }
    if (event.exception?.values) {
      for (const ex of event.exception.values) {
        if (typeof ex.value === "string") ex.value = applyRules(ex.value);
        const frames = ex.stacktrace?.frames;
        if (frames) {
          for (const frame of frames) {
            if (frame.vars) {
              frame.vars = scrubValue(frame.vars, 0) as typeof frame.vars;
            }
          }
        }
      }
    }

    return event;
  } catch {
    // Scrubbing failed - never send a potentially un-scrubbed event.
    return null;
  }
}
