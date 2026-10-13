"use client";

import * as React from "react";
import { createPortal } from "react-dom";

/**
 * A page can show its own content in the shared top header, on the right of
 * the page title (desktop header) or as a second row under it (mobile /
 * tablet header) - e.g. the POS network status + invoice number + time.
 *
 * The shared headers render an empty <PageHeaderSlotTarget>; the page renders
 * <PageHeaderSlot>, a React portal into the target of the header currently
 * shown. The content stays in the page's own React tree (same state, same
 * handlers - nothing is lifted or copied). Without a provider (a page shown
 * outside the dashboard shell, e.g. the offline POS shell) the page's
 * `fallback` is rendered in place instead, so nothing is ever lost.
 */

type SlotTargets = {
  desktop: HTMLElement | null;
  mobile: HTMLElement | null;
  setDesktop: (element: HTMLElement | null) => void;
  setMobile: (element: HTMLElement | null) => void;
};

const PageHeaderSlotContext = React.createContext<SlotTargets | null>(null);

export function PageHeaderSlotProvider({ children }: { children: React.ReactNode }) {
  const [desktop, setDesktop] = React.useState<HTMLElement | null>(null);
  const [mobile, setMobile] = React.useState<HTMLElement | null>(null);
  const value = React.useMemo(() => ({ desktop, mobile, setDesktop, setMobile }), [desktop, mobile]);
  return <PageHeaderSlotContext.Provider value={value}>{children}</PageHeaderSlotContext.Provider>;
}

/** Rendered by the shared headers: where a page's header content appears (empty and hidden otherwise). */
export function PageHeaderSlotTarget({ kind, className }: { kind: "desktop" | "mobile"; className?: string }) {
  const slots = React.useContext(PageHeaderSlotContext);
  if (!slots) return null;
  return <div ref={kind === "desktop" ? slots.setDesktop : slots.setMobile} className={className} data-page-header-slot={kind} />;
}

/** Same breakpoint as the headers themselves: the desktop header is `hidden lg:block`, the mobile one `lg:hidden`. */
const DESKTOP_QUERY = "(min-width: 64rem)";

function subscribeToDesktopQuery(onChange: () => void) {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function useIsDesktopHeader() {
  return React.useSyncExternalStore(
    subscribeToDesktopQuery,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true,
  );
}

/** Rendered by a page: shows `children` in the header currently displayed, or `fallback` where there is no shared header. */
export function PageHeaderSlot({ children, fallback }: { children: React.ReactNode; fallback: React.ReactNode }) {
  const slots = React.useContext(PageHeaderSlotContext);
  const isDesktop = useIsDesktopHeader();
  if (!slots) return <>{fallback}</>;
  const target = isDesktop ? slots.desktop : slots.mobile;
  return target ? createPortal(children, target) : null;
}
