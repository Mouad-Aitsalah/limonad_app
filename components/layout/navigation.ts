import { driverNavItems } from "@/components/driver/driver-nav-items";
import { navItems, type NavItem } from "@/components/layout/nav-items";
import { moduleForPagePath } from "@/lib/modules/registry";
import { isModuleEnabled } from "@/lib/modules/settings";
import type { UserRole } from "@/types/auth";

/** A menu entry whose page belongs to a module disabled for the organisation is hidden. */
function isHrefEnabled(href: string | undefined, disabledModules: readonly string[] | undefined) {
  const moduleKey = href ? moduleForPagePath(href) : null;
  return !moduleKey || isModuleEnabled(disabledModules, moduleKey);
}

// Shared by the desktop sidebar and the mobile launcher. Super admins
// only see explicitly granted platform modules, as in the original sidebar.
// `disabledModules` (CurrentUser.disabledModules) hides the entries of the
// modules the SUPER_ADMIN disabled - display only, the server refuses those
// pages and APIs on its own (lib/server/module-guard.ts).
export function getVisibleNavItems(
  role: UserRole | undefined,
  disabledModules?: readonly string[],
): NavItem[] {
  if (!role) return [];
  if (role === "driver") return driverNavItems.filter((item) => isHrefEnabled(item.href, disabledModules));

  const hiddenForCashier = new Set(["/dashboard", "/comptabilite/journal"]);
  const allowed = (item: { roles?: UserRole[]; href?: string }) =>
    !(role === "cashier" && item.href && hiddenForCashier.has(item.href)) &&
    isHrefEnabled(item.href, disabledModules) &&
    (role === "super_admin"
      ? item.roles?.includes(role) ?? false
      : !item.roles || item.roles.includes(role));

  return navItems.filter(allowed).flatMap((item) => {
    const children = item.children?.filter(allowed);
    if (children && !item.href && children.length === 0) return [];
    return [{ ...item, children }];
  });
}

export function getNavigationLinks(role: UserRole | undefined, disabledModules?: readonly string[]) {
  return getVisibleNavItems(role, disabledModules).flatMap((item) => [
    ...(item.href ? [{ label: item.label, href: item.href, icon: item.icon }] : []),
    ...(item.children ?? []).map((child) => ({ ...child, icon: item.icon })),
  ]);
}

export function getNavigationPageLabel(pathname: string, role: UserRole | undefined) {
  // Prefer the most specific match: /pos/versements must not be titled POS.
  return getNavigationLinks(role)
    .sort((a, b) => b.href.length - a.href.length)
    .find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    ?.label ?? "COMDIS";
}
