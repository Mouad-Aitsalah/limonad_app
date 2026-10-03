import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  canCreateManualEntryWithStatus,
  getManualEntryAccess,
  MANUAL_ENTRY_ADMIN_ROLES,
  MANUAL_ENTRY_CREATE_ROLES,
} from "@/lib/accounting-entry-access";
import type { UserRole } from "@/types/auth";

const ALL_ROLES: UserRole[] = ["super_admin", "admin", "depot_manager", "cashier", "driver"];
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("page access: admin, super admin and cashier enter entries; every other role is blocked", () => {
  const allowed = ALL_ROLES.filter((role) => getManualEntryAccess(role).canEnter);
  assert.deepEqual(allowed.sort(), ["admin", "cashier", "super_admin"]);
  for (const role of ["depot_manager", "driver"] as const) {
    assert.deepEqual(getManualEntryAccess(role), { canEnter: false, canManageDrafts: false, canRevise: false });
  }
  assert.deepEqual(getManualEntryAccess(undefined), { canEnter: false, canManageDrafts: false, canRevise: false });
  assert.deepEqual(getManualEntryAccess(null), { canEnter: false, canManageDrafts: false, canRevise: false });
});

test("the cashier enters and validates an entry but gets no administrative power", () => {
  assert.deepEqual(getManualEntryAccess("cashier"), { canEnter: true, canManageDrafts: false, canRevise: false });
  assert.equal(canCreateManualEntryWithStatus("cashier", "POSTED"), true);
  assert.equal(canCreateManualEntryWithStatus("cashier", undefined), true, "default status is POSTED");
  assert.equal(canCreateManualEntryWithStatus("cashier", "DRAFT"), false, "no archive for a cashier");
});

test("admin and super admin keep every right", () => {
  for (const role of ["admin", "super_admin"] as const) {
    assert.deepEqual(getManualEntryAccess(role), { canEnter: true, canManageDrafts: true, canRevise: true });
    assert.equal(canCreateManualEntryWithStatus(role, "POSTED"), true);
    assert.equal(canCreateManualEntryWithStatus(role, "DRAFT"), true);
  }
});

test("other roles cannot create anything, whatever the status", () => {
  for (const role of ["depot_manager", "driver"] as const) {
    assert.equal(canCreateManualEntryWithStatus(role, "POSTED"), false);
    assert.equal(canCreateManualEntryWithStatus(role, "DRAFT"), false);
  }
});

test("role lists: create = admin roles + cashier, never the other roles", () => {
  assert.deepEqual([...MANUAL_ENTRY_ADMIN_ROLES].sort(), ["admin", "super_admin"]);
  assert.deepEqual([...MANUAL_ENTRY_CREATE_ROLES].sort(), ["admin", "cashier", "super_admin"]);
});

// --- server enforcement (source guards: lib/server/accounting.ts is server-only) -------------

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const next = source.indexOf("\nexport ", start + 10);
  return source.slice(start, next === -1 ? undefined : next);
}

test("server: only creation opens to the cashier, and it refuses a cashier DRAFT", () => {
  const source = read("./server/accounting.ts");
  const create = functionBody(source, "createManualAccountingEntry");
  assert.match(create, /requireOrganizationUser\(MANUAL_ENTRY_CREATE_ROLES\)/);
  assert.match(create, /canCreateManualEntryWithStatus\(user\.role, input\.status\)/);
  assert.match(create, /AuthServiceError\("Acces non autorise\.", 403\)/);
});

test("server: drafts, validation, deletion, correction and reading stay admin-only", () => {
  const source = read("./server/accounting.ts");
  for (const name of [
    "getManualAccountingEntry",
    "listAccountingDraftEntries",
    "updateManualDraftEntry",
    "validateDraftAccountingEntry",
    "deleteDraftAccountingEntry",
    "reviseManualAccountingEntry",
  ]) {
    const body = functionBody(source, name);
    assert.match(body, /requireOrganizationUser\(MANUAL_ENTRY_ADMIN_ROLES\)/, name);
    assert.equal(/MANUAL_ENTRY_CREATE_ROLES|"cashier"/.test(body), false, `${name} not open to cashier`);
  }
});

test("server: accounts and accounting settings administration is unchanged (admin only)", () => {
  const source = read("./server/accounting.ts");
  for (const name of [
    "createAccountingAccount",
    "updateAccountingAccount",
    "setAccountingAccountActive",
    "updateAccountingSettings",
  ]) {
    assert.match(functionBody(source, name), /requireOrganizationUser\(\["admin"\]\)/, name);
  }
});

test("every entries route still goes through those guarded service functions", () => {
  const entries = read("../app/api/accounting/entries/route.ts");
  assert.match(entries, /createManualAccountingEntry\(body\)/);
  assert.match(entries, /rejectUntrustedOrigin/);
  const byId = read("../app/api/accounting/entries/[id]/route.ts");
  for (const fn of ["reviseManualAccountingEntry", "updateManualDraftEntry", "deleteDraftAccountingEntry"]) {
    assert.ok(byId.includes(fn), fn);
  }
  assert.ok(read("../app/api/accounting/entries/[id]/validate/route.ts").includes("validateDraftAccountingEntry"));
  assert.ok(read("../app/api/accounting/entries/drafts/route.ts").includes("listAccountingDraftEntries"));
});

// --- interface -------------------------------------------------------------------------------

test("interface: the page derives everything from the shared policy; the cashier gets no draft tools", () => {
  const page = read("../app/(dashboard)/comptabilite/ecritures/page.tsx");
  assert.match(page, /getManualEntryAccess\(user\?\.role\)/);
  assert.match(page, /canManage=\{access\.canEnter\}/);
  assert.match(page, /canManageDrafts=\{access\.canManageDrafts\}/);
  assert.equal(/role === "admin"/.test(page), false);
  assert.match(page, /access\.canManageDrafts \? listAccountingDraftEntries\(\)/);
  assert.match(page, /access\.canRevise && reviseId/);

  const view = read("../components/accounting/accounting-entries-view.tsx");
  assert.match(view, /\) : canManageDrafts \? \(\s*draftNav/, "draft navigation hidden without draft rights");
  assert.match(view, /\{canManageDrafts \? \(\s*<Button[\s\S]*?Archiver/, "Archiver hidden without draft rights");
  assert.match(view, /canManageDrafts && activeDraftId/, "delete hidden without draft rights");
  assert.match(view, /réservée aux administrateurs et\s+aux caissiers/);
});
