/**
 * « Sécurité du dashboard » - pure rules (no I/O, usable by the server, the UI and the tests).
 *
 * Per organisation, set by the SUPER_ADMIN: off = the dashboard is exactly as before; on =
 * the dashboard needs a dedicated password (created by the organisation's admin) that is
 * asked at every visit, and optionally renewed every N weeks / months.
 */

export const DASHBOARD_RENEWAL_PERIODS = [
  "ONE_WEEK",
  "TWO_WEEKS",
  "ONE_MONTH",
  "TWO_MONTHS",
  "THREE_MONTHS",
  "SIX_MONTHS",
] as const;
export type DashboardRenewalPeriod = (typeof DASHBOARD_RENEWAL_PERIODS)[number];

export const DEFAULT_DASHBOARD_RENEWAL_PERIOD: DashboardRenewalPeriod = "ONE_MONTH";

const PERIOD_DEFINITIONS: Record<DashboardRenewalPeriod, { label: string; days?: number; months?: number }> = {
  ONE_WEEK: { label: "1 semaine", days: 7 },
  TWO_WEEKS: { label: "2 semaines", days: 14 },
  ONE_MONTH: { label: "1 mois", months: 1 },
  TWO_MONTHS: { label: "2 mois", months: 2 },
  THREE_MONTHS: { label: "3 mois", months: 3 },
  SIX_MONTHS: { label: "6 mois", months: 6 },
};

export const DASHBOARD_RENEWAL_PERIOD_OPTIONS: ReadonlyArray<{ value: DashboardRenewalPeriod; label: string }> =
  DASHBOARD_RENEWAL_PERIODS.map((value) => ({ value, label: PERIOD_DEFINITIONS[value].label }));

export function isDashboardRenewalPeriod(value: unknown): value is DashboardRenewalPeriod {
  return typeof value === "string" && (DASHBOARD_RENEWAL_PERIODS as readonly string[]).includes(value);
}

export function dashboardRenewalPeriodLabel(period: DashboardRenewalPeriod): string {
  return PERIOD_DEFINITIONS[period].label;
}

/** `from` + the period (UTC). Months clamp to the last day of the target month (31 Jan + 1 month = 28/29 Feb). */
export function addDashboardRenewalPeriod(from: Date, period: DashboardRenewalPeriod): Date {
  const definition = PERIOD_DEFINITIONS[period];
  if (definition.days) return new Date(from.getTime() + definition.days * 24 * 60 * 60 * 1000);
  const months = definition.months ?? 0;
  const target = new Date(from.getTime());
  const day = target.getUTCDate();
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

/** Expiry date of a password set at `setAt`; null when the renewal is off (valid until changed). */
export function computeDashboardPasswordExpiry(
  setAt: Date,
  renewalEnabled: boolean,
  period: DashboardRenewalPeriod,
): Date | null {
  return renewalEnabled ? addDashboardRenewalPeriod(setAt, period) : null;
}

export type DashboardSecurityConfig = {
  enabled: boolean;
  hasPassword: boolean;
  renewalEnabled: boolean;
  passwordExpiresAt: Date | null;
};

/**
 * - disabled:          no obligation (nothing changes for the dashboard);
 * - creation_required: no password yet -> the admin must create one;
 * - renewal_required:  the password is past its expiry -> the admin must set a new one;
 * - unlock_required:   a valid password exists -> asked at every visit.
 */
export type DashboardSecurityState = "disabled" | "creation_required" | "renewal_required" | "unlock_required";

export function evaluateDashboardSecurity(config: DashboardSecurityConfig, now: Date): DashboardSecurityState {
  if (!config.enabled) return "disabled";
  if (!config.hasPassword) return "creation_required";
  if (config.renewalEnabled && config.passwordExpiresAt && config.passwordExpiresAt.getTime() <= now.getTime()) {
    return "renewal_required";
  }
  return "unlock_required";
}

// --- Temporary authorization & brute force ---------------------------------------------------

/** A grant dies after this much inactivity (slid on every authorised dashboard request). */
export const DASHBOARD_GRANT_IDLE_MS = 15 * 60 * 1000;
/** ...and never lives longer than this since it was issued. */
export const DASHBOARD_GRANT_MAX_MS = 8 * 60 * 60 * 1000;
/** The expiry is only re-written when it is older than this (one write per minute at most). */
export const DASHBOARD_GRANT_SLIDE_THRESHOLD_MS = 60 * 1000;

export const DASHBOARD_MAX_FAILED_ATTEMPTS = 5;
export const DASHBOARD_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

export const DASHBOARD_PASSWORD_MIN_LENGTH = 10;
export const DASHBOARD_PASSWORD_MAX_LENGTH = 128;

/** Strength rule of the dashboard password. Returns the first problem in French, or null when acceptable. */
export function validateDashboardPassword(password: string): string | null {
  if (password.length < DASHBOARD_PASSWORD_MIN_LENGTH) {
    return `Le mot de passe doit contenir au moins ${DASHBOARD_PASSWORD_MIN_LENGTH} caractères.`;
  }
  if (password.length > DASHBOARD_PASSWORD_MAX_LENGTH) {
    return `Le mot de passe ne peut pas dépasser ${DASHBOARD_PASSWORD_MAX_LENGTH} caractères.`;
  }
  if (!/[a-z]/.test(password)) return "Le mot de passe doit contenir au moins une lettre minuscule.";
  if (!/[A-Z]/.test(password)) return "Le mot de passe doit contenir au moins une lettre majuscule.";
  if (!/[0-9]/.test(password)) return "Le mot de passe doit contenir au moins un chiffre.";
  return null;
}

// --- DTOs shared between the server and the UI -----------------------------------------------

/** What the organisation's admin / users see on /dashboard (never the hash). */
export type DashboardGateDto = {
  state: Exclude<DashboardSecurityState, "disabled">;
  /** Only the organisation's admin can create / renew the password. */
  canSetPassword: boolean;
  renewalEnabled: boolean;
  renewalPeriod: DashboardRenewalPeriod;
  passwordExpiresAt: string | null;
};

/** What the SUPER_ADMIN sees for ONE organisation (never the hash, never the password). */
export type OrganizationDashboardSecurityDto = {
  organizationId: string;
  enabled: boolean;
  renewalEnabled: boolean;
  renewalPeriod: DashboardRenewalPeriod;
  passwordSet: boolean;
  passwordSetAt: string | null;
  passwordExpiresAt: string | null;
  state: DashboardSecurityState;
};

// --- new visit detection ---------------------------------------------------------------------

/**
 * True only for a REAL full page load of the dashboard (address bar, reload, bookmark, link from elsewhere,
 * new tab). Next.js hides its own RSC headers from headers() - `rsc` is ALWAYS absent there - so the browser's
 * fetch metadata is used instead: a document load carries `Sec-Fetch-Dest: document`, whereas
 * router.refresh(), in-app navigations and prefetches are fetch() calls (`Sec-Fetch-Dest: empty`).
 * Prudent by design: a missing or ambiguous header (old browser, proxy that strips it, prefetch / prerender
 * purpose, a non-navigate mode) is NOT a new visit, so a freshly created authorization is never revoked by mistake.
 */
export function isFullDocumentLoad(headers: { get(name: string): string | null }): boolean {
  if (headers.get("sec-fetch-dest")?.trim().toLowerCase() !== "document") return false;
  const mode = headers.get("sec-fetch-mode")?.trim().toLowerCase();
  if (mode && mode !== "navigate") return false;
  const purpose = `${headers.get("sec-purpose") ?? ""} ${headers.get("purpose") ?? ""}`.toLowerCase();
  if (purpose.includes("prefetch") || purpose.includes("prerender")) return false;
  return true;
}
