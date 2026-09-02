import "server-only";

import { z } from "zod";

/**
 * Shared password strength rule, applied at every place a password is
 * created or (in the future) changed: minimum 10 characters, at least one
 * letter and one digit. Special characters are never required, but never
 * rejected either - nothing here restricts the character set, so any
 * symbol a user wants to add is accepted on top of the minimum.
 *
 * Deliberately NOT applied to the login schema (app/api/auth/login/route.ts)
 * - existing accounts created under the old 6-character rule must keep
 * being able to log in with their current password. This is a
 * creation/change-time rule only, per this task's explicit scope: it does
 * not retroactively invalidate any existing password.
 */
export const passwordPolicySchema = z
  .string()
  .min(10, "Le mot de passe doit contenir au moins 10 caracteres.")
  .regex(/[A-Za-z]/, "Le mot de passe doit contenir au moins une lettre.")
  .regex(/[0-9]/, "Le mot de passe doit contenir au moins un chiffre.");
