import "dotenv/config";

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, mock, test } from "node:test";

import bcrypt from "bcryptjs";

import type { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * « Sécurité du dashboard » over HTTP, against a THROWAWAY PostgreSQL database: the SUPER_ADMIN switch / renewal /
 * reset, the admin's password creation, the unlock at every visit, the grant tied to session + user + organisation,
 * the expiry, the brute-force limit, the refusal of the dashboard data APIs without validation and the isolation
 * between two organisations. A "browser" is a session token + its cookie jar.
 *
 * Same safety as the other HTTP tests: nothing runs unless D2_TEST_DATABASE_URL names the local database
 * `commdis_d2_test` AND DATABASE_URL is that very URL; run it through `npm run test:db`.
 */

const D2 = process.env.D2_TEST_DATABASE_URL;
function isThrowaway(url: string | undefined): boolean {
  if (!url || process.env.DATABASE_URL !== url) return false;
  try {
    const parsed = new URL(url);
    return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname) && parsed.port === "5432" && parsed.pathname === "/commdis_d2_test";
  } catch {
    return false;
  }
}
const enabled = isThrowaway(D2);
const mocksAvailable = typeof (mock as unknown as { module?: unknown }).module === "function";
const SKIP = !enabled
  ? "D2_TEST_DATABASE_URL is not the throwaway database commdis_d2_test (use the wrapper)"
  : !mocksAvailable
    ? "node module mocks unavailable: add --experimental-test-module-mocks"
    : false;

const ORIGIN = "https://app.test";
const LOGIN_PASSWORD = "LoginPass123";
const DASH_PASSWORD = "Dashboard-Pass-2026";

type Handler = (request: Request, context?: { params: Promise<{ id: string }> }) => Promise<Response>;
type Browser = { token: string | null; jar: Record<string, string> };

let prisma: PrismaClient;
let current: Browser = { token: null, jar: {} };
let unlockRoute: { POST: Handler };
let passwordRoute: { POST: Handler };
let lockRoute: { POST: Handler };
let settingsRoute: { GET: Handler; PUT: Handler };
let resetRoute: { POST: Handler };
let receivablesRoute: { GET: Handler };
let coverageRoute: { GET: Handler };
let salesAnalysisRoute: { GET: Handler };
let security: typeof import("@/lib/server/dashboard-security");
let directionDashboard: typeof import("@/lib/server/dashboard-direction");

before(async () => {
  if (SKIP) return;
  mock.module("next/headers", {
    namedExports: {
      headers: async () => new Headers(current.token ? { authorization: `Bearer ${current.token}` } : {}),
      cookies: async () => ({
        get: (name: string) => (current.jar[name] !== undefined ? { name, value: current.jar[name] } : undefined),
        set: () => undefined,
      }),
    },
  });
  prisma = (await import("@/lib/prisma")).prisma;
  unlockRoute = (await import("@/app/api/dashboard/security/unlock/route")) as { POST: Handler };
  passwordRoute = (await import("@/app/api/dashboard/security/password/route")) as { POST: Handler };
  lockRoute = (await import("@/app/api/dashboard/security/lock/route")) as { POST: Handler };
  settingsRoute = (await import("@/app/api/organizations/[id]/dashboard-security/route")) as { GET: Handler; PUT: Handler };
  resetRoute = (await import("@/app/api/organizations/[id]/dashboard-security/reset/route")) as { POST: Handler };
  receivablesRoute = (await import("@/app/api/dashboard/receivables/route")) as { GET: Handler };
  coverageRoute = (await import("@/app/api/dashboard/coverage/route")) as { GET: Handler };
  salesAnalysisRoute = (await import("@/app/api/dashboard/sales-analysis/route")) as { GET: Handler };
  security = await import("@/lib/server/dashboard-security");
  directionDashboard = await import("@/lib/server/dashboard-direction");
  const row = await prisma.$queryRaw<Array<{ db: string }>>`select current_database() as db`;
  assert.equal(row[0].db, "commdis_d2_test", "connected to the throwaway database");
});

after(async () => {
  if (!SKIP) await prisma.$disconnect().catch(() => undefined);
});

const uid = () => randomUUID().replace(/-/g, "").slice(0, 10);
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

type Role = "admin" | "depot_manager" | "cashier";
const PRISMA_ROLE = { admin: "ADMIN", depot_manager: "DEPOT_MANAGER", cashier: "CASHIER" } as const;
const LOGIN_HASH = bcrypt.hashSync(LOGIN_PASSWORD, 4);

async function newSession(userId: string): Promise<Browser> {
  const token = `tok-${randomUUID()}`;
  await prisma.session.create({ data: { userId, tokenHash: sha(token), expiresAt: new Date(Date.now() + 3_600_000) } });
  return { token, jar: {} };
}

async function makeOrg(label: string) {
  const suffix = uid();
  const organization = await prisma.organization.create({ data: { code: `DS-${label}-${suffix}`.toUpperCase(), name: `Dashboard ${label}` } });
  const users = {} as Record<Role, { id: string; browser: Browser }>;
  for (const role of Object.keys(PRISMA_ROLE) as Role[]) {
    const user = await prisma.user.create({
      data: {
        organizationId: organization.id,
        firstName: role,
        lastName: label,
        fullName: `${role} ${label}`,
        email: `ds-${role}-${suffix}@example.invalid`,
        passwordHash: LOGIN_HASH,
        role: PRISMA_ROLE[role],
      },
    });
    users[role] = { id: user.id, browser: await newSession(user.id) };
  }
  return { id: organization.id, users };
}
type Org = Awaited<ReturnType<typeof makeOrg>>;

async function makeSuperAdmin() {
  const user = await prisma.user.create({
    data: {
      firstName: "Super",
      lastName: "Admin",
      fullName: "Super Admin",
      email: `ds-super-${uid()}@example.invalid`,
      passwordHash: LOGIN_HASH,
      role: "SUPER_ADMIN",
    },
  });
  return { id: user.id, browser: await newSession(user.id) };
}

function applySetCookies(browser: Browser, response: Response) {
  for (const line of response.headers.getSetCookie()) {
    const [pair, ...attributes] = line.split(";").map((part) => part.trim());
    const eq = pair.indexOf("=");
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    const expired = attributes.some((attribute) => /^max-age=0$/i.test(attribute));
    if (!value || expired) delete browser.jar[name];
    else browser.jar[name] = value;
  }
}

async function call(
  handler: Handler,
  browser: Browser,
  options: { method?: "GET" | "POST" | "PUT"; path?: string; body?: unknown; id?: string; origin?: string | null } = {},
) {
  current = browser;
  const headers: Record<string, string> = { "x-forwarded-host": "app.test", "x-forwarded-proto": "https" };
  if (options.origin !== null) headers.origin = options.origin ?? ORIGIN;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const request = new Request(`${ORIGIN}${options.path ?? "/api/x"}`, {
    method: options.method ?? "POST",
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const response = await handler(request, options.id ? { params: Promise.resolve({ id: options.id }) } : undefined);
  applySetCookies(browser, response);
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { raw: text };
  }
  return { status: response.status, json, setCookies: response.headers.getSetCookie(), text };
}

const lock = (browser: Browser) => call(lockRoute.POST, browser, { path: "/api/dashboard/security/lock" });
const grantCookie = (browser: Browser): string | undefined => browser.jar["comdis.dashboard"];
const settingsOf = (org: { id: string }, superAdmin: { browser: Browser }, body: Record<string, unknown>) =>
  call(settingsRoute.PUT, superAdmin.browser, { method: "PUT", id: org.id, body });
const enable = (org: { id: string }, sa: { browser: Browser }, over: Record<string, unknown> = {}) =>
  settingsOf(org, sa, { enabled: true, renewalEnabled: false, renewalPeriod: "ONE_MONTH", ...over });
const receivables = (browser: Browser) => call(receivablesRoute.GET, browser, { method: "GET", path: "/api/dashboard/receivables" });
const createPassword = (browser: Browser, password = DASH_PASSWORD, confirmation = password) =>
  call(passwordRoute.POST, browser, { path: "/api/dashboard/security/password", body: { password, confirmation } });
const unlock = (browser: Browser, password: string) => call(unlockRoute.POST, browser, { path: "/api/dashboard/security/unlock", body: { password } });
const access = async (org: Org, role: Role) => {
  current = org.users[role].browser;
  const { requireOrganizationUser } = await import("@/lib/server/organization-context");
  return security.resolveDashboardAccess(await requireOrganizationUser());
};

test("security off (no setting): the dashboard and its APIs behave as before", { skip: SKIP }, async () => {
  const org = await makeOrg("off");
  assert.deepEqual(await access(org, "admin"), { status: "open", secured: false });
  assert.equal((await receivables(org.users.admin.browser)).status, 200);
  current = org.users.cashier.browser;
  await directionDashboard.getDirectionDashboardData({}); // does not throw
  assert.equal(await prisma.organizationDashboardSecurity.count({ where: { organizationId: org.id } }), 0);
});

test("security enabled: no password yet -> admin sees the creation gate, other roles wait for the admin, APIs refused", { skip: SKIP }, async () => {
  const sa = await makeSuperAdmin();
  const org = await makeOrg("create");
  assert.equal((await enable(org, sa)).status, 200);

  const adminAccess = await access(org, "admin");
  assert.equal(adminAccess.status, "gate");
  if (adminAccess.status === "gate") {
    assert.equal(adminAccess.gate.state, "creation_required");
    assert.equal(adminAccess.gate.canSetPassword, true);
  }
  const cashierAccess = await access(org, "cashier");
  assert.equal(cashierAccess.status === "gate" && cashierAccess.gate.canSetPassword, false);

  // the server refuses the data without any validation - API routes and the server function behind the page
  assert.equal((await receivables(org.users.admin.browser)).status, 403);
  assert.equal((await call(coverageRoute.GET, org.users.admin.browser, { method: "GET", path: "/api/dashboard/coverage" })).status, 403);
  assert.equal((await call(salesAnalysisRoute.GET, org.users.admin.browser, { method: "GET", path: "/api/dashboard/sales-analysis" })).status, 403);
  current = org.users.cashier.browser;
  await assert.rejects(() => directionDashboard.getDirectionDashboardData({}), (error: unknown) => (error as { status?: number }).status === 403);
  current = org.users.depot_manager.browser;
  await assert.rejects(() => directionDashboard.getDirectionDashboardData({}), (error: unknown) => (error as { status?: number }).status === 403);

  // a non-admin can never create the password
  assert.equal((await createPassword(org.users.cashier.browser)).status, 403);
  assert.equal((await createPassword(org.users.depot_manager.browser)).status, 403);
  assert.equal((await prisma.organizationDashboardSecurity.findUniqueOrThrow({ where: { organizationId: org.id } })).passwordHash, null);
});

test("password creation: strength rules, confirmation, dedicated password, hash only, then the dashboard opens", { skip: SKIP }, async () => {
  const sa = await makeSuperAdmin();
  const org = await makeOrg("pwd");
  await enable(org, sa);
  const admin = org.users.admin.browser;

  assert.equal((await createPassword(admin, "short1A")).status, 422);
  assert.equal((await createPassword(admin, "alllowercase123")).status, 422);
  assert.equal((await createPassword(admin, "ALLUPPERCASE123")).status, 422);
  assert.equal((await createPassword(admin, "NoDigitsHereAtAll")).status, 422);
  assert.equal((await createPassword(admin, DASH_PASSWORD, "Different-Pass-2026")).status, 422);
  // a strong password, but it is the account's own login password: a dedicated one is required
  const sameAsLogin = await createPassword(admin, LOGIN_PASSWORD);
  assert.equal(sameAsLogin.status, 422);
  assert.match(String(sameAsLogin.json.message), /différent/);
  assert.equal((await prisma.organizationDashboardSecurity.findUniqueOrThrow({ where: { organizationId: org.id } })).passwordHash, null, "nothing stored by the refused attempts");

  const created = await createPassword(admin);
  assert.equal(created.status, 200);
  const cookie = created.setCookies.find((line) => line.startsWith("comdis.dashboard="));
  assert.ok(cookie, "grant cookie issued");
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=strict/i);
  assert.equal(JSON.stringify(created.json).includes(DASH_PASSWORD), false, "the password is never echoed");

  const row = await prisma.organizationDashboardSecurity.findUniqueOrThrow({ where: { organizationId: org.id } });
  assert.ok(row.passwordHash && row.passwordHash.startsWith("$2"), "a bcrypt hash");
  assert.notEqual(row.passwordHash, DASH_PASSWORD);
  assert.equal(await bcrypt.compare(DASH_PASSWORD, row.passwordHash), true);
  assert.ok(row.passwordSetAt);
  assert.equal(row.passwordExpiresAt, null, "renewal off: no expiry");
  assert.equal((await receivables(admin)).status, 200, "dashboard data now served");

  // the creation is only possible once
  assert.equal((await createPassword(admin, "Another-Pass-2026")).status, 409);
  const audit = await prisma.auditLog.findMany({ where: { organizationId: org.id, action: { startsWith: "DASHBOARD_" } } });
  assert.ok(audit.some((entry) => entry.action === "DASHBOARD_PASSWORD_CREATED"));
  assert.equal(JSON.stringify(audit).includes(DASH_PASSWORD), false, "no secret in the audit log");
  assert.equal(JSON.stringify(audit).includes("$2"), false, "no hash in the audit log");
});

test("every visit asks the password: leaving locks, wrong password refused generically, right one opens", { skip: SKIP }, async () => {
  const sa = await makeSuperAdmin();
  const org = await makeOrg("visit");
  await enable(org, sa);
  const admin = org.users.admin.browser;
  await createPassword(admin);
  assert.equal((await receivables(admin)).status, 200);

  // leaving the dashboard
  const left = await lock(admin);
  assert.equal(left.status, 200);
  assert.equal(admin.jar["comdis.dashboard"], undefined, "cookie cleared");
  assert.equal(await prisma.dashboardAccessGrant.count({ where: { organizationId: org.id } }), 0);
  assert.equal((await receivables(admin)).status, 403, "next visit is locked");
  const gate = await access(org, "admin");
  assert.equal(gate.status === "gate" && gate.gate.state, "unlock_required");

  const wrong = await unlock(admin, "Wrong-Password-1");
  assert.equal(wrong.status, 401);
  assert.equal(wrong.json.message, "Mot de passe invalide.");
  assert.equal(admin.jar["comdis.dashboard"], undefined, "no cookie on failure");
  assert.equal((await receivables(admin)).status, 403);

  const good = await unlock(admin, DASH_PASSWORD);
  assert.equal(good.status, 200);
  assert.equal((await receivables(admin)).status, 200);
  assert.deepEqual(await access(org, "admin"), { status: "open", secured: true });
  // the browser only holds a random token; the database stores its hash, never the token itself
  const token = grantCookie(admin);
  assert.ok(token && token.length >= 40);
  const grants = await prisma.dashboardAccessGrant.findMany({ where: { organizationId: org.id } });
  assert.equal(grants.length, 1);
  assert.equal(grants[0].tokenHash, sha(token));
  assert.notEqual(grants[0].tokenHash, token);

  // other roles unlock with the same dedicated password (their own grants)
  const cashier = org.users.cashier.browser;
  assert.equal((await unlock(cashier, "Wrong-Password-1")).status, 401);
  assert.equal((await unlock(cashier, DASH_PASSWORD)).status, 200);
  current = cashier;
  await directionDashboard.getDirectionDashboardData({});
});

test("a grant is tied to its session, its user and its organisation", { skip: SKIP }, async () => {
  const sa = await makeSuperAdmin();
  const orgA = await makeOrg("bindA");
  const orgB = await makeOrg("bindB");
  await enable(orgA, sa);
  await enable(orgB, sa);
  await createPassword(orgA.users.admin.browser);
  await createPassword(orgB.users.admin.browser, "Org-B-Password-2026");
  const token = orgA.users.admin.browser.jar["comdis.dashboard"];
  assert.ok(token);

  // same user, ANOTHER session (stolen grant cookie on a different login)
  const otherSession = await newSession(orgA.users.admin.id);
  otherSession.jar["comdis.dashboard"] = token;
  assert.equal((await receivables(otherSession)).status, 403);

  // another user of the same organisation with the cookie
  const cashierSession = org(orgA.users.cashier.browser);
  cashierSession.jar["comdis.dashboard"] = token;
  current = cashierSession;
  await assert.rejects(() => directionDashboard.getDirectionDashboardData({}), (error: unknown) => (error as { status?: number }).status === 403);

  // the admin of ANOTHER organisation with organisation A's cookie, and with the right org B password
  const adminB = orgB.users.admin.browser;
  adminB.jar = { "comdis.dashboard": token };
  assert.equal((await receivables(adminB)).status, 403);
  assert.equal((await unlock(adminB, DASH_PASSWORD)).status, 401, "A's password does not open B");
  assert.equal((await unlock(adminB, "Org-B-Password-2026")).status, 200);
  assert.equal((await receivables(adminB)).status, 200);
  assert.equal((await receivables(orgA.users.admin.browser)).status, 200, "A untouched");

  // a forged / random cookie
  const forged = await newSession(orgA.users.admin.id);
  forged.jar["comdis.dashboard"] = "x".repeat(43);
  assert.equal((await receivables(forged)).status, 403);

  function org(browser: Browser): Browser {
    return { token: browser.token, jar: { ...browser.jar } };
  }
});

test("brute force: after 5 wrong attempts even the right password is refused (429), per user", { skip: SKIP }, async () => {
  const sa = await makeSuperAdmin();
  const org = await makeOrg("brute");
  await enable(org, sa);
  const admin = org.users.admin.browser;
  await createPassword(admin);
  await lock(admin);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await unlock(admin, `Wrong-Password-${attempt}x`)).status, 401);
  }
  const blocked = await unlock(admin, DASH_PASSWORD);
  assert.equal(blocked.status, 429);
  assert.equal(admin.jar["comdis.dashboard"], undefined);
  assert.equal(JSON.stringify(blocked.json).includes(DASH_PASSWORD), false);

  // another user of the same organisation has his own counter
  assert.equal((await unlock(org.users.cashier.browser, DASH_PASSWORD)).status, 200);
});

test("renewal on: expiry = creation + period, expired password refuses everything until renewed", { skip: SKIP }, async () => {
  const sa = await makeSuperAdmin();
  const org = await makeOrg("renew");
  await enable(org, sa, { renewalEnabled: true, renewalPeriod: "TWO_WEEKS" });
  const admin = org.users.admin.browser;
  const created = await createPassword(admin);
  assert.equal(created.status, 200);

  const row = await prisma.organizationDashboardSecurity.findUniqueOrThrow({ where: { organizationId: org.id } });
  assert.ok(row.passwordSetAt && row.passwordExpiresAt);
  assert.equal(row.passwordExpiresAt.getTime() - row.passwordSetAt.getTime(), 14 * 24 * 60 * 60 * 1000);
  const dto = await call(settingsRoute.GET, sa.browser, { method: "GET", id: org.id });
  assert.equal(dto.json.passwordExpiresAt, row.passwordExpiresAt.toISOString(), "next renewal date exposed to the Super Admin");
  assert.equal(dto.json.state, "unlock_required");
  assert.equal((await receivables(admin)).status, 200);

  // the period elapses
  await prisma.organizationDashboardSecurity.update({ where: { organizationId: org.id }, data: { passwordExpiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await receivables(admin)).status, 403, "the open grant stops working at expiry");
  const gate = await access(org, "admin");
  assert.equal(gate.status === "gate" && gate.gate.state, "renewal_required");
  const cashierGate = await access(org, "cashier");
  assert.equal(cashierGate.status === "gate" && cashierGate.gate.canSetPassword, false);
  await lock(admin);
  assert.equal((await unlock(admin, DASH_PASSWORD)).status, 401, "the expired password no longer unlocks");

  // renewal: must differ from the expired one, then a fresh expiry
  assert.equal((await createPassword(admin, DASH_PASSWORD)).status, 422);
  assert.equal((await createPassword(org.users.cashier.browser, "Fresh-Password-2027")).status, 403);
  const renewed = await createPassword(admin, "Fresh-Password-2027");
  assert.equal(renewed.status, 200);
  const after = await prisma.organizationDashboardSecurity.findUniqueOrThrow({ where: { organizationId: org.id } });
  assert.ok(after.passwordExpiresAt && after.passwordExpiresAt.getTime() > Date.now() + 13 * 24 * 60 * 60 * 1000);
  assert.equal((await receivables(admin)).status, 200);
  assert.ok((await prisma.auditLog.findMany({ where: { organizationId: org.id } })).some((entry) => entry.action === "DASHBOARD_PASSWORD_RENEWED"));
});

test("renewal off: an old password stays valid until reset; switching renewal on/off recomputes the expiry", { skip: SKIP }, async () => {
  const sa = await makeSuperAdmin();
  const org = await makeOrg("norenew");
  await enable(org, sa);
  const admin = org.users.admin.browser;
  await createPassword(admin);
  await prisma.organizationDashboardSecurity.update({
    where: { organizationId: org.id },
    data: { passwordSetAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000) },
  });
  await lock(admin);
  assert.equal((await unlock(admin, DASH_PASSWORD)).status, 200, "a 400-day old password is still valid without renewal");

  // renewal switched on with a 1-week period: that 400-day old password is immediately due
  assert.equal((await enable(org, sa, { renewalEnabled: true, renewalPeriod: "ONE_WEEK" })).json.state, "renewal_required");
  assert.equal((await receivables(admin)).status, 403);
  // switched off again: valid again, no expiry
  const off = await enable(org, sa, { renewalEnabled: false });
  assert.equal(off.json.state, "unlock_required");
  assert.equal(off.json.passwordExpiresAt, null);
  await lock(admin);
  assert.equal((await unlock(admin, DASH_PASSWORD)).status, 200);
});

test("SUPER_ADMIN reset: old password dead, all grants deleted, admin must create a new one, other organisation untouched", { skip: SKIP }, async () => {
  const sa = await makeSuperAdmin();
  const orgA = await makeOrg("resetA");
  const orgB = await makeOrg("resetB");
  await enable(orgA, sa);
  await enable(orgB, sa);
  await createPassword(orgA.users.admin.browser);
  await createPassword(orgB.users.admin.browser);
  await unlock(orgA.users.cashier.browser, DASH_PASSWORD);
  assert.equal((await receivables(orgA.users.admin.browser)).status, 200);
  const versionBefore = (await prisma.organizationDashboardSecurity.findUniqueOrThrow({ where: { organizationId: orgA.id } })).securityVersion;
  const rowB = await prisma.organizationDashboardSecurity.findUniqueOrThrow({ where: { organizationId: orgB.id } });

  // roles other than the SUPER_ADMIN, and anonymous callers, cannot reset
  assert.equal((await call(resetRoute.POST, orgA.users.admin.browser, { id: orgA.id })).status, 403);
  assert.equal((await call(resetRoute.POST, orgA.users.cashier.browser, { id: orgA.id })).status, 403);
  assert.equal((await call(resetRoute.POST, { token: null, jar: {} }, { id: orgA.id })).status, 401);
  assert.equal((await receivables(orgA.users.admin.browser)).status, 200, "nothing changed yet");

  const reset = await call(resetRoute.POST, sa.browser, { id: orgA.id });
  assert.equal(reset.status, 200);
  assert.equal(reset.json.passwordSet, false);
  assert.equal(reset.json.state, "creation_required");
  const after = await prisma.organizationDashboardSecurity.findUniqueOrThrow({ where: { organizationId: orgA.id } });
  assert.equal(after.passwordHash, null);
  assert.equal(after.passwordSetAt, null);
  assert.equal(after.securityVersion, versionBefore + 1);
  assert.equal(await prisma.dashboardAccessGrant.count({ where: { organizationId: orgA.id } }), 0, "all temporary authorizations deleted");

  // the previously valid cookies are dead, the old password does not unlock, a new one must be created
  assert.equal((await receivables(orgA.users.admin.browser)).status, 403);
  current = orgA.users.cashier.browser;
  await assert.rejects(() => directionDashboard.getDirectionDashboardData({}), (error: unknown) => (error as { status?: number }).status === 403);
  assert.equal((await unlock(orgA.users.admin.browser, DASH_PASSWORD)).status, 401);
  const gate = await access(orgA, "admin");
  assert.equal(gate.status === "gate" && gate.gate.state, "creation_required");
  assert.equal((await createPassword(orgA.users.admin.browser, "Brand-New-Pass-2026")).status, 200);
  assert.equal((await receivables(orgA.users.admin.browser)).status, 200);

  // organisation B: byte-for-byte untouched, its grant still valid
  const rowBAfter = await prisma.organizationDashboardSecurity.findUniqueOrThrow({ where: { organizationId: orgB.id } });
  assert.equal(rowBAfter.passwordHash, rowB.passwordHash);
  assert.equal(rowBAfter.securityVersion, rowB.securityVersion);
  assert.equal((await receivables(orgB.users.admin.browser)).status, 200);
  assert.ok((await prisma.auditLog.findMany({ where: { organizationId: orgA.id } })).some((entry) => entry.action === "DASHBOARD_PASSWORD_RESET"));
});

test("disabling removes the obligation at once but keeps the hash; re-enabling invalidates older grants", { skip: SKIP }, async () => {
  const sa = await makeSuperAdmin();
  const org = await makeOrg("toggle");
  await enable(org, sa);
  const admin = org.users.admin.browser;
  await createPassword(admin);
  const hash = (await prisma.organizationDashboardSecurity.findUniqueOrThrow({ where: { organizationId: org.id } })).passwordHash;
  const staleCookie = admin.jar["comdis.dashboard"];

  const disabled = await settingsOf(org, sa, { enabled: false, renewalEnabled: false, renewalPeriod: "ONE_MONTH" });
  assert.equal(disabled.status, 200);
  assert.equal(disabled.json.state, "disabled");
  assert.equal((await receivables(org.users.admin.browser)).status, 200);
  const fresh = await newSession(org.users.cashier.id);
  assert.deepEqual(await (async () => { current = fresh; const { requireOrganizationUser } = await import("@/lib/server/organization-context"); return security.resolveDashboardAccess(await requireOrganizationUser()); })(), { status: "open", secured: false });
  assert.equal((await prisma.organizationDashboardSecurity.findUniqueOrThrow({ where: { organizationId: org.id } })).passwordHash, hash, "hash kept");

  await settingsOf(org, sa, { enabled: true, renewalEnabled: false, renewalPeriod: "ONE_MONTH" });
  const stale = { token: admin.token, jar: { "comdis.dashboard": staleCookie } };
  assert.equal((await receivables(stale)).status, 403, "grant issued before the toggle is dead");
  assert.equal((await unlock(admin, DASH_PASSWORD)).status, 200, "the kept password works again");
});

test("permissions: only the SUPER_ADMIN reads or writes the settings; nothing secret is ever returned", { skip: SKIP }, async () => {
  const sa = await makeSuperAdmin();
  const org = await makeOrg("perm");
  const body = { enabled: true, renewalEnabled: false, renewalPeriod: "ONE_MONTH" };
  for (const role of ["admin", "depot_manager", "cashier"] as const) {
    const browser = org.users[role].browser;
    assert.equal((await call(settingsRoute.PUT, browser, { method: "PUT", id: org.id, body })).status, 403, `${role} cannot write`);
    assert.equal((await call(settingsRoute.GET, browser, { method: "GET", id: org.id })).status, 403, `${role} cannot read`);
  }
  assert.equal((await call(settingsRoute.GET, { token: null, jar: {} }, { method: "GET", id: org.id })).status, 401);
  assert.equal((await call(settingsRoute.PUT, sa.browser, { method: "PUT", id: "does-not-exist", body })).status, 404);
  assert.equal((await call(settingsRoute.PUT, sa.browser, { method: "PUT", id: org.id, body: { enabled: "yes" } })).status, 422);
  assert.equal((await call(settingsRoute.PUT, sa.browser, { method: "PUT", id: org.id, body: { ...body, renewalPeriod: "ONE_DAY" } })).status, 422);
  for (const period of ["ONE_WEEK", "TWO_WEEKS", "ONE_MONTH", "TWO_MONTHS", "THREE_MONTHS", "SIX_MONTHS"]) {
    assert.equal((await call(settingsRoute.PUT, sa.browser, { method: "PUT", id: org.id, body: { ...body, renewalEnabled: true, renewalPeriod: period } })).status, 200, period);
  }

  // CSRF: a cross-origin mutating call is refused before anything runs
  assert.equal((await call(settingsRoute.PUT, sa.browser, { method: "PUT", id: org.id, body, origin: "https://evil.test" })).status, 403);
  assert.equal((await call(resetRoute.POST, sa.browser, { id: org.id, origin: "https://evil.test" })).status, 403);
  assert.equal((await call(unlockRoute.POST, org.users.admin.browser, { path: "/api/dashboard/security/unlock", body: { password: "x" }, origin: "https://evil.test" })).status, 403);

  // after a password exists, nothing the SUPER_ADMIN can fetch contains it or its hash
  await createPassword(org.users.admin.browser);
  const read = await call(settingsRoute.GET, sa.browser, { method: "GET", id: org.id });
  assert.equal(read.status, 200);
  assert.equal(read.json.passwordSet, true);
  assert.equal(read.text.includes(DASH_PASSWORD), false);
  assert.equal(read.text.includes("$2"), false);
  assert.equal("passwordHash" in read.json, false);
  const reset = await call(resetRoute.POST, sa.browser, { id: org.id });
  assert.equal(reset.text.includes("$2"), false);
});

test("settings of one organisation never leak to another", { skip: SKIP }, async () => {
  const sa = await makeSuperAdmin();
  const orgA = await makeOrg("isoA");
  const orgB = await makeOrg("isoB");
  await enable(orgA, sa, { renewalEnabled: true, renewalPeriod: "SIX_MONTHS" });
  assert.equal(await prisma.organizationDashboardSecurity.count({ where: { organizationId: orgB.id } }), 0);
  assert.deepEqual(await access(orgB, "admin"), { status: "open", secured: false });
  assert.equal((await receivables(orgB.users.admin.browser)).status, 200);

  await enable(orgB, sa);
  const a = await call(settingsRoute.GET, sa.browser, { method: "GET", id: orgA.id });
  const b = await call(settingsRoute.GET, sa.browser, { method: "GET", id: orgB.id });
  assert.equal(a.json.renewalEnabled, true);
  assert.equal(a.json.renewalPeriod, "SIX_MONTHS");
  assert.equal(b.json.renewalEnabled, false);
  assert.equal(b.json.renewalPeriod, "ONE_MONTH");

  // an admin creating a password only ever creates it for his own organisation
  await createPassword(orgA.users.admin.browser);
  assert.equal((await prisma.organizationDashboardSecurity.findUniqueOrThrow({ where: { organizationId: orgB.id } })).passwordHash, null);
});

test("a full page load is a NEW visit (password asked again); an in-app navigation keeps the open visit", { skip: SKIP }, async () => {
  const sa = await makeSuperAdmin();
  const org = await makeOrg("newvisit");
  await enable(org, sa);
  const admin = org.users.admin.browser;
  await createPassword(admin);
  assert.equal((await receivables(admin)).status, 200);

  const { requireOrganizationUser } = await import("@/lib/server/organization-context");
  current = admin;
  const user = await requireOrganizationUser();
  assert.deepEqual(await security.resolveDashboardAccess(user, { newVisit: false }), { status: "open", secured: true });
  assert.deepEqual(await security.resolveDashboardAccess(user), { status: "open", secured: true }, "in-app navigation / refresh");

  const reload = await security.resolveDashboardAccess(user, { newVisit: true });
  assert.equal(reload.status === "gate" && reload.gate.state, "unlock_required");
  assert.equal(await prisma.dashboardAccessGrant.count({ where: { organizationId: org.id } }), 0, "the grant is gone server-side");
  assert.equal((await receivables(admin)).status, 403, "and the data APIs are refused again");
  assert.equal((await unlock(admin, DASH_PASSWORD)).status, 200);
  assert.equal((await receivables(admin)).status, 200);

  // security off: a page load never touches anything
  const off = await makeOrg("newvisit-off");
  current = off.users.admin.browser;
  assert.deepEqual(await security.resolveDashboardAccess(await requireOrganizationUser(), { newVisit: true }), { status: "open", secured: false });
});
