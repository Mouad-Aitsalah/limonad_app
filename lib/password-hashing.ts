/**
 * Centralized bcrypt cost factor for every NEW password hash created by
 * COMDIS (user creation, organization admin provisioning, the demo seed).
 * Previously inconsistent across the codebase - 10 in one place, 8 or 12
 * in others - with no single source of truth.
 *
 * Deliberately NOT under lib/server/ (no "server-only" marker): this value
 * has no secrecy to protect (it is a tuning parameter, not a credential)
 * and prisma/seed.ts - a standalone script run outside Next.js's bundler,
 * where the "server-only" package cannot resolve at all - needs to import
 * it too. Matches the existing lib/sales-calculations.ts precedent for
 * logic shared between the app and standalone scripts.
 *
 * Raising this number does NOT invalidate or require rehashing any
 * password already stored: bcrypt encodes the cost it was hashed with
 * inside the hash string itself (e.g. "$2a$10$..." vs "$2a$12$..."), so
 * bcrypt.compare() keeps verifying old hashes correctly against whatever
 * cost they actually used, forever - it never needs to know or care what
 * BCRYPT_COST currently is.
 */
export const BCRYPT_COST = 12;
