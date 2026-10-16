import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OrganizationDashboardSecurityPanel } from "@/components/organizations/organization-dashboard-security-panel";
import type { OrganizationDashboardSecurityDto } from "@/lib/dashboard-security";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

function dto(over: Partial<OrganizationDashboardSecurityDto> = {}): OrganizationDashboardSecurityDto {
  return {
    organizationId: "org-1",
    enabled: false,
    renewalEnabled: false,
    renewalPeriod: "ONE_MONTH",
    passwordSet: false,
    passwordSetAt: null,
    passwordExpiresAt: null,
    state: "disabled",
    ...over,
  };
}

const render = (initialSecurity: OrganizationDashboardSecurityDto | null) =>
  renderToStaticMarkup(createElement(OrganizationDashboardSecurityPanel, { organizationId: "org-1", initialSecurity }));

test("security off: only the activation switch, no renewal option, no reset button", () => {
  const markup = render(dto());
  assert.ok(markup.includes("Sécurité du dashboard"));
  assert.ok(markup.includes("Activer la sécurité du dashboard"));
  assert.ok(markup.includes("Désactivée"));
  assert.equal(markup.includes("Renouvellement périodique du mot de passe"), false);
  assert.equal(markup.includes("Réinitialiser le mot de passe dashboard"), false);
});

test("security on, no password yet: renewal switch + reset button, 'to create' status, no renewal date", () => {
  const markup = render(dto({ enabled: true, state: "creation_required" }));
  assert.ok(markup.includes("Renouvellement périodique du mot de passe"));
  assert.ok(markup.includes("Réinitialiser le mot de passe dashboard"));
  assert.ok(markup.includes("Mot de passe à créer"));
  assert.ok(markup.includes("Aucun mot de passe dashboard défini"));
  assert.equal(markup.includes("Prochain renouvellement"), false);
  assert.equal(markup.includes("<select"), false, "the period selector only shows when the renewal is on");
});

test("renewal on: period selector with the six periods and the next renewal date once the password exists", () => {
  const markup = render(
    dto({
      enabled: true,
      renewalEnabled: true,
      renewalPeriod: "TWO_WEEKS",
      passwordSet: true,
      passwordSetAt: "2026-10-16T10:00:00.000Z",
      passwordExpiresAt: "2026-10-30T10:00:00.000Z",
      state: "unlock_required",
    }),
  );
  for (const label of ["1 semaine", "2 semaines", "1 mois", "2 mois", "3 mois", "6 mois"]) {
    assert.ok(markup.includes(`>${label}</option>`), label);
  }
  assert.match(markup, /<option value="TWO_WEEKS" selected/);
  assert.ok(markup.includes("Mot de passe dashboard défini"));
  assert.ok(markup.includes("Prochain renouvellement : 30 octobre 2026"));
  assert.ok(markup.includes("Active"));
});

test("renewal off with a password: no renewal date is shown", () => {
  const markup = render(
    dto({ enabled: true, passwordSet: true, passwordSetAt: "2026-10-16T10:00:00.000Z", state: "unlock_required" }),
  );
  assert.ok(markup.includes("Mot de passe dashboard défini"));
  assert.equal(markup.includes("Prochain renouvellement"), false);
});

test("the panel never receives nor shows a password or a hash", () => {
  const markup = render(dto({ enabled: true, passwordSet: true, passwordSetAt: "2026-10-16T10:00:00.000Z", state: "unlock_required" }));
  assert.equal(/passwordHash|\$2[aby]\$|type="password"/.test(markup), false);
});

test("load failure: a retry is offered instead of the settings", () => {
  const markup = render(null);
  assert.ok(markup.includes("Impossible de charger la sécurité du dashboard."));
  assert.ok(markup.includes("Réessayer"));
  assert.equal(markup.includes("Activer la sécurité du dashboard"), false);
});

test("the panel is wired in the organisation detail page (Super Admin space)", () => {
  assert.ok(read("components/organizations/organization-detail-view.tsx").includes("<OrganizationDashboardSecurityPanel"));
  const page = read("app/organisations/[id]/page.tsx");
  assert.ok(page.includes("getOrganizationDashboardSecurity(id)"));
  assert.ok(page.includes("initialDashboardSecurity={initialDashboardSecurity}"));
});

test("the dashboard page renders the gate BEFORE reading any dashboard data", () => {
  const page = read("app/(dashboard)/dashboard/page.tsx");
  const access = page.indexOf("resolveDashboardAccess(");
  const gate = page.indexOf("<DashboardSecurityGate");
  const data = page.indexOf("getDirectionDashboardData(params)");
  assert.ok(access > 0 && gate > access && data > gate, "access check, then gate, then data");
  assert.ok(page.includes("<DashboardLeaveGuard"));
});

test("every dashboard data entry point calls requireDashboardAccess right after its role check", () => {
  const entryPoints: Array<[string, RegExp]> = [
    ["lib/server/dashboard-direction.ts", /requireOrganizationUser\(\["admin", "depot_manager", "cashier"\]\);\n(?:  \/\/[^\n]*\n)*  await requireDashboardAccess\(currentUser\)/],
    ["lib/server/dashboard.ts", /requireOrganizationUser\(\["admin", "depot_manager", "cashier"\]\);\n  await requireDashboardAccess\(currentUser\)/],
    ["lib/server/receivables.ts", /getReceivablesOverview[\s\S]*?requireOrganizationUser\([^\n]*\);\n  await requireDashboardAccess\(user\)/],
    ["lib/server/receivables.ts", /getCustomerReceivableDetail[\s\S]*?requireOrganizationUser\([^\n]*\);\n  await requireDashboardAccess\(user\)/],
    ["lib/server/receivables.ts", /updateReceivablesSettings[\s\S]*?requireOrganizationUser\([^\n]*\);\n  await requireDashboardAccess\(user\)/],
    ["lib/server/commercial-analysis.ts", /getSalesAnalysis[\s\S]*?requireOrganizationUser\([^\n]*\);\n  await requireDashboardAccess\(user\)/],
    ["lib/server/commercial-analysis.ts", /getCoverage[\s\S]*?requireOrganizationUser\([^\n]*\);\n  await requireDashboardAccess\(user\)/],
    ["lib/server/dashboard-forecast.ts", /requireOrganizationUser\(FORECAST_VIEW_ROLES\);\n      await requireDashboardAccess\(user\)/],
    ["lib/server/sales-forecast.ts", /requireOrganizationUser\(\["admin", "depot_manager"\]\);\n  await requireDashboardAccess\(user\)/],
  ];
  for (const [file, pattern] of entryPoints) {
    assert.match(read(file), pattern, `${file} ${pattern.source.slice(0, 40)}`);
  }
});

test("the grant cookie is httpOnly + strict, never readable by scripts, and no secret goes to storage or the URL", () => {
  const http = read("lib/server/dashboard-security-http.ts");
  assert.match(http, /httpOnly: true/);
  assert.match(http, /sameSite: "strict"/);
  for (const file of [
    "components/dashboard/security/dashboard-security-gate.tsx",
    "components/dashboard/security/dashboard-leave-guard.tsx",
    "components/organizations/organization-dashboard-security-panel.tsx",
  ]) {
    const source = read(file);
    assert.equal(/localStorage|sessionStorage|document\.cookie|console\./.test(source), false, `${file} stores/logs nothing`);
    assert.equal(/\?password=|searchParams.*password/.test(source), false);
  }
});

test("the assistant cannot be a way around the password: dashboard-figure tools are guarded", () => {
  const chat = read("app/api/ai/chat/route.ts");
  const declared = /DASHBOARD_FIGURE_TOOLS[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(chat)?.[1] ?? "";
  for (const tool of ["get_sales_summary", "get_top_selling_products", "get_customer_receivables_summary", "list_top_customer_receivables"]) {
    assert.ok(declared.includes(`"${tool}"`), tool);
  }

  assert.match(chat, /DASHBOARD_FIGURE_TOOLS\.has\(functionCall\.name\)[\s\S]*?requireDashboardAccess\(user\)/);
});

test("the dashboard page treats a full document request (no RSC header) as a new visit", () => {
  const page = read("app/(dashboard)/dashboard/page.tsx");
  assert.match(page, /const newVisit = !\(await headers\(\)\)\.get\("rsc"\)/);
  assert.match(page, /resolveDashboardAccess\([\s\S]*?\{ newVisit \}\)/);
});
