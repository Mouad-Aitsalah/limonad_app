import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { UserEditForm } from "@/components/users/user-edit-form";
import type { User } from "@/types/user";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

const user: User = {
  id: "u1",
  nom: "Sara Alaoui",
  email: "sara@example.test",
  telephone: "",
  role: "cashier",
  actif: true,
  organizationId: "org",
  organizationName: "Org",
  depotId: "dep-1",
  depotName: "Dépôt principal",
  derniereConnexion: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  driver: null,
};

test("Modifier utilisateur: name and email are editable fields prefilled with the current values; the role stays read-only", () => {
  const markup = renderToStaticMarkup(<UserEditForm user={user} onCancel={() => {}} onSaved={() => {}} />);
  assert.match(markup, /<input[^>]*id="user-edit-name-u1"[^>]*value="Sara Alaoui"/);
  assert.match(markup, /<input[^>]*type="email"[^>]*id="user-edit-email-u1"[^>]*value="sara@example.test"|<input[^>]*id="user-edit-email-u1"[^>]*type="email"[^>]*value="sara@example.test"/);
  assert.ok(markup.includes("Rôle"));
  // one save button, disabled while nothing changed
  assert.match(markup, /<button[^>]*disabled=""[^>]*>Enregistrer<\/button>/);
  assert.equal(markup.includes("Enregistrer le dépôt"), false);
});

test("the form sends ONLY what changed, validates the email, and shows the server's field errors", () => {
  const source = read("components/users/user-edit-form.tsx");
  assert.match(source, /if \(nameChanged\) body\.nom = trimmedName;/);
  assert.match(source, /if \(emailChanged\) body\.email = normalizedEmail;/);
  assert.match(source, /if \(depotChanged\) body\.depotId =/);
  assert.match(source, /else if \(!EMAIL_PATTERN\.test\(normalizedEmail\)\) errors\.email = "L'adresse email est invalide\.";/);
  assert.match(source, /setFieldErrors\(result\.fieldErrors \?\? \{\}\);/);
  // the list is refreshed through onSaved with the server's user
  assert.match(source, /saved = \{ \.\.\.result\.user, driver: user\.driver \};/);
  assert.match(source, /onSaved\(saved\);/);
  // never a password field in this window
  assert.equal(/password/i.test(source), false);
});

test("server: admin only, own organisation, only the fields sent, unique lower-cased email, audited", () => {
  const source = read("lib/server/users.ts");
  const update = source.slice(source.indexOf("export async function updateUser"), source.indexOf("function validateCreateUserInput"));
  assert.match(update, /const currentUser = await requireOrganizationUser\(\["admin"\]\);/);
  assert.match(update, /where: \{ id: userId, organizationId: currentUser\.organizationId \}/);
  assert.match(source, /nom: z\.string\(\)\.trim\(\)\.min\(1, "Le nom est obligatoire\."\)[^\n]*\.optional\(\),/);
  assert.match(source, /email: z\s*\.string\(\)\s*\.trim\(\)\s*\.toLowerCase\(\)\s*\.email\("L'adresse email est invalide\."\)\s*\.optional\(\),/);
  // uniqueness against the OTHER users only
  assert.match(update, /where: \{ email: parsed\.data\.email, NOT: \{ id: target\.id \} \}/);
  assert.match(update, /"Cet email est deja utilise par un autre utilisateur\.", 409/);
  // a field that is not sent is never cleared (the depot used to be reset when absent)
  assert.match(update, /if \(parsed\.data\.depotId !== undefined\) \{/);
  // role, password, status: never written by this update
  assert.equal(/passwordHash|role:|status:/.test(update.replace(/select: \{[^}]*\}/g, "")), false);
  assert.match(update, /action: "USER_UPDATED"/);
  // the PATCH route keeps its CSRF check
  assert.match(read("app/api/users/[id]/route.ts"), /const csrfRejection = rejectUntrustedOrigin\(request\);/);
});
