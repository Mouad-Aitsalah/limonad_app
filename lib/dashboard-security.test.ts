import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DASHBOARD_ATTEMPT_WINDOW_MS,
  DASHBOARD_GRANT_IDLE_MS,
  DASHBOARD_GRANT_MAX_MS,
  DASHBOARD_MAX_FAILED_ATTEMPTS,
  DASHBOARD_RENEWAL_PERIOD_OPTIONS,
  addDashboardRenewalPeriod,
  computeDashboardPasswordExpiry,
  dashboardRenewalPeriodLabel,
  evaluateDashboardSecurity,
  isDashboardRenewalPeriod,
  validateDashboardPassword,
} from "@/lib/dashboard-security";

const NOW = new Date("2026-10-16T10:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

test("renewal periods: the six choices, in order, with French labels", () => {
  assert.deepEqual(
    DASHBOARD_RENEWAL_PERIOD_OPTIONS.map((option) => option.label),
    ["1 semaine", "2 semaines", "1 mois", "2 mois", "3 mois", "6 mois"],
  );
  assert.equal(isDashboardRenewalPeriod("ONE_WEEK"), true);
  assert.equal(isDashboardRenewalPeriod("ONE_DAY"), false);
  assert.equal(isDashboardRenewalPeriod(7), false);
  assert.equal(dashboardRenewalPeriodLabel("THREE_MONTHS"), "3 mois");
});

test("expiry = creation date + period (weeks exact, months calendar-aware and clamped)", () => {
  assert.equal(addDashboardRenewalPeriod(NOW, "ONE_WEEK").getTime(), NOW.getTime() + 7 * DAY);
  assert.equal(addDashboardRenewalPeriod(NOW, "TWO_WEEKS").getTime(), NOW.getTime() + 14 * DAY);
  assert.equal(addDashboardRenewalPeriod(NOW, "ONE_MONTH").toISOString(), "2026-11-16T10:00:00.000Z");
  assert.equal(addDashboardRenewalPeriod(NOW, "TWO_MONTHS").toISOString(), "2026-12-16T10:00:00.000Z");
  assert.equal(addDashboardRenewalPeriod(NOW, "THREE_MONTHS").toISOString(), "2027-01-16T10:00:00.000Z");
  assert.equal(addDashboardRenewalPeriod(NOW, "SIX_MONTHS").toISOString(), "2027-04-16T10:00:00.000Z");
  // end-of-month clamp: 31 Jan + 1 month = 28 Feb (2027), 29 Feb on a leap year
  assert.equal(addDashboardRenewalPeriod(new Date("2027-01-31T08:00:00.000Z"), "ONE_MONTH").toISOString(), "2027-02-28T08:00:00.000Z");
  assert.equal(addDashboardRenewalPeriod(new Date("2028-01-31T08:00:00.000Z"), "ONE_MONTH").toISOString(), "2028-02-29T08:00:00.000Z");
  assert.equal(addDashboardRenewalPeriod(new Date("2026-08-31T08:00:00.000Z"), "SIX_MONTHS").toISOString(), "2027-02-28T08:00:00.000Z");
});

test("renewal off: no expiry; renewal on: the expiry is computed", () => {
  assert.equal(computeDashboardPasswordExpiry(NOW, false, "ONE_WEEK"), null);
  assert.equal(computeDashboardPasswordExpiry(NOW, true, "ONE_WEEK")?.getTime(), NOW.getTime() + 7 * DAY);
});

test("state: off -> no obligation whatever the rest says", () => {
  assert.equal(
    evaluateDashboardSecurity({ enabled: false, hasPassword: false, renewalEnabled: true, passwordExpiresAt: new Date(0) }, NOW),
    "disabled",
  );
  assert.equal(
    evaluateDashboardSecurity({ enabled: false, hasPassword: true, renewalEnabled: false, passwordExpiresAt: null }, NOW),
    "disabled",
  );
});

test("state: on without password -> creation; with password -> unlock at every visit", () => {
  assert.equal(
    evaluateDashboardSecurity({ enabled: true, hasPassword: false, renewalEnabled: false, passwordExpiresAt: null }, NOW),
    "creation_required",
  );
  assert.equal(
    evaluateDashboardSecurity({ enabled: true, hasPassword: true, renewalEnabled: false, passwordExpiresAt: null }, NOW),
    "unlock_required",
  );
});

test("state: renewal on -> valid until the expiry instant, expired from that instant", () => {
  const config = (expiresAt: Date | null) => ({ enabled: true, hasPassword: true, renewalEnabled: true, passwordExpiresAt: expiresAt });
  assert.equal(evaluateDashboardSecurity(config(new Date(NOW.getTime() + 1)), NOW), "unlock_required");
  assert.equal(evaluateDashboardSecurity(config(new Date(NOW.getTime())), NOW), "renewal_required");
  assert.equal(evaluateDashboardSecurity(config(new Date(NOW.getTime() - DAY)), NOW), "renewal_required");
  // renewal off ignores an old expiry date
  assert.equal(
    evaluateDashboardSecurity({ enabled: true, hasPassword: true, renewalEnabled: false, passwordExpiresAt: new Date(0) }, NOW),
    "unlock_required",
  );
});

test("password strength: 10+ chars with lower, upper and digit", () => {
  assert.equal(validateDashboardPassword("Dashboard-Pass-2026"), null);
  assert.equal(validateDashboardPassword("Abcdefgh12"), null);
  assert.match(validateDashboardPassword("Abc1") ?? "", /au moins 10/);
  assert.match(validateDashboardPassword("ABCDEFGHIJ12") ?? "", /minuscule/);
  assert.match(validateDashboardPassword("abcdefghij12") ?? "", /majuscule/);
  assert.match(validateDashboardPassword("Abcdefghijkl") ?? "", /chiffre/);
  assert.match(validateDashboardPassword(`Aa1${"x".repeat(130)}`) ?? "", /dépasser/);
});

test("temporary authorization and brute-force limits are sane", () => {
  assert.ok(DASHBOARD_GRANT_IDLE_MS >= 5 * 60 * 1000 && DASHBOARD_GRANT_IDLE_MS <= 30 * 60 * 1000);
  assert.ok(DASHBOARD_GRANT_MAX_MS > DASHBOARD_GRANT_IDLE_MS);
  assert.ok(DASHBOARD_MAX_FAILED_ATTEMPTS >= 3 && DASHBOARD_MAX_FAILED_ATTEMPTS <= 10);
  assert.ok(DASHBOARD_ATTEMPT_WINDOW_MS >= 5 * 60 * 1000);
});
