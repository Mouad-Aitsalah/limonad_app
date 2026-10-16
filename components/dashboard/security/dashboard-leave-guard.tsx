"use client";

import * as React from "react";

/**
 * Rendered by /dashboard only while the dashboard security is on and the dashboard is open: when the user
 * leaves the page (menu click, back button...), the server-side authorization is deleted so coming back asks the
 * password again. A short delay absorbs React's development double-mount, and a remount within it keeps the
 * authorization (it is the same visit). A closed tab or a failed request cannot be reported: the grant then
 * simply expires after its idle time on the server (see DASHBOARD_GRANT_IDLE_MS), and the cookie is a
 * browser-session cookie.
 */
const LOCK_DELAY_MS = 300;
let pendingLock: ReturnType<typeof setTimeout> | null = null;

export function DashboardLeaveGuard() {
  React.useEffect(() => {
    if (pendingLock) {
      clearTimeout(pendingLock);
      pendingLock = null;
    }
    return () => {
      pendingLock = setTimeout(() => {
        pendingLock = null;
        void fetch("/api/dashboard/security/lock", { method: "POST", keepalive: true }).catch(() => undefined);
      }, LOCK_DELAY_MS);
    };
  }, []);

  return null;
}
