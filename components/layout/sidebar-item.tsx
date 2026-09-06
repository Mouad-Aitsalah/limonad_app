import Link from "next/link";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import type { NavItem } from "@/components/layout/nav-items";

type SidebarItemProps = {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  pathname: string;
  /** Whether this group's sub-menu is expanded (only one group open at a
   * time - controlled by the parent Sidebar). Ignored for leaf items. */
  open?: boolean;
  onToggleGroup?: () => void;
  onNavigate?: () => void;
  onExpandSidebar?: () => void;
};

export function SidebarItem({
  item,
  active,
  collapsed,
  pathname,
  open = false,
  onToggleGroup,
  onNavigate,
  onExpandSidebar,
}: SidebarItemProps) {
  const Icon = item.icon;
  const isOpen = !collapsed && open;

  if (item.children?.length) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => {
            if (collapsed) onExpandSidebar?.();
            onToggleGroup?.();
          }}
          aria-expanded={isOpen}
          title={collapsed ? item.label : undefined}
          className={cn(
            "group relative flex w-full items-center gap-3 overflow-hidden rounded-[18px] border px-3.5 py-3.5 text-left transition-all duration-200 ease-out",
            collapsed ? "justify-center px-2.5 py-4" : "",
            active
              ? "translate-x-[3px] border-white/14 bg-white/12 text-white"
              : "border-[var(--sidebar-card-border)] bg-[var(--sidebar-card)] text-[var(--sidebar-foreground)]/92 hover:translate-x-[2px] hover:border-white/14 hover:bg-white/9",
          )}
        >
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border transition-colors duration-200",
              active
                ? "border-emerald-300/25 bg-emerald-400/18 text-emerald-200"
                : "border-white/10 bg-white/6 text-white/90 group-hover:border-white/16 group-hover:bg-white/10",
            )}
          >
            <Icon aria-hidden="true" className="h-5 w-5" />
          </div>

          {!collapsed && (
            <>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{item.label}</span>
                {item.description ? (
                  <p
                    className={cn(
                      "mt-1 line-clamp-2 text-xs leading-5",
                      active ? "text-white/78" : "text-white/56",
                    )}
                  >
                    {item.description}
                  </p>
                ) : null}
              </div>

              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 transition-transform",
                  isOpen && "rotate-180",
                )}
              />
            </>
          )}
        </button>

        {!collapsed && isOpen && (
          <div className="ml-6 space-y-1.5 border-l border-white/10 pl-4">
            {item.children.map((child) => {
              const childActive =
                pathname === child.href ||
                (!child.exact && pathname.startsWith(`${child.href}/`));

              return (
                <Link
                  key={child.href}
                  href={child.href}
                  onClick={onNavigate}
                  aria-current={childActive ? "page" : undefined}
                  className={cn(
                    "block rounded-[14px] border px-3.5 py-2.5 text-sm font-medium transition-all duration-200 ease-out",
                    childActive
                      ? "border-white/14 bg-white/12 text-white"
                      : "border-transparent text-white/68 hover:border-white/12 hover:bg-white/8 hover:text-white",
                  )}
                >
                  {child.label}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <Link
      href={item.href ?? "#"}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        "group relative flex items-center gap-3 overflow-hidden rounded-[18px] border px-3.5 py-3.5 transition-all duration-200 ease-out",
        collapsed ? "justify-center px-2.5 py-4" : "",
        active
          ? "translate-x-[3px] border-white/14 bg-white/12 text-white"
          : "border-[var(--sidebar-card-border)] bg-[var(--sidebar-card)] text-[var(--sidebar-foreground)]/92 hover:translate-x-[2px] hover:border-white/14 hover:bg-white/9",
      )}
    >
      <div
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border transition-colors duration-200",
          active
            ? "border-emerald-300/25 bg-emerald-400/18 text-emerald-200"
            : "border-white/10 bg-white/6 text-white/90 group-hover:border-white/16 group-hover:bg-white/10",
        )}
      >
        <Icon aria-hidden="true" className="h-5 w-5" />
      </div>

      {!collapsed && (
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{item.label}</span>
          {item.description ? (
            <p
              className={cn(
                "mt-1 line-clamp-2 text-xs leading-5",
                active ? "text-white/78" : "text-white/56",
              )}
            >
              {item.description}
            </p>
          ) : null}
        </div>
      )}
    </Link>
  );
}
