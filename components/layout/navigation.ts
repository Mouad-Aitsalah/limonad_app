import { driverNavItems } from "@/components/driver/driver-nav-items";
import { navItems, type NavItem } from "@/components/layout/nav-items";
import type { UserRole } from "@/types/auth";

// Shared by the desktop sidebar and the mobile launcher. Super admins
// only see explicitly granted platform modules, as in the original sidebar.
export function getVisibleNavItems(role: UserRole | undefined): NavItem[] {
  if (!role) return [];
  if (role === "driver") return driverNavItems;

  const allowed = (item: { roles?: UserRole[] }) =>
    role === "super_admin"
      ? item.roles?.includes(role) ?? false
      : !item.roles || item.roles.includes(role);

  return navItems.filter(allowed).flatMap((item) => {
    const children = item.children?.filter(allowed);
    if (children && !item.href && children.length === 0) return [];
    return [{ ...item, children }];
  });
}

export function getNavigationLinks(role: UserRole | undefined) {
  return getVisibleNavItems(role).flatMap((item) => [
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
