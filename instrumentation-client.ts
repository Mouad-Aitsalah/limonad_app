/**
 * Sentry init for the browser. Next.js 15.3+/16 loads this file automatically
 * (replaces the old `sentry.client.config.ts`).
 *
 * 4Q.4A foundation: DSN-only, no source maps.
 *   - Session Replay: fully disabled (would capture customer names / phones /
 *     addresses / the map). `integrations: []` keeps only the SDK defaults
 *     minus Replay; Replay is a lazy integration that is simply never added.
 *   - tracing: off (inherited from commonSentryInit()).
 *   - browser noise (extension errors, ResizeObserver, bare promise
 *     rejections) filtered out so it never touches the free-tier quota.
 */
import * as Sentry from "@sentry/nextjs";

import { commonSentryInit } from "@/lib/sentry-options";

const base = commonSentryInit();

Sentry.init({
  ...base,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  integrations: [],
  denyUrls: [
    /^chrome-extension:\/\//,
    /^moz-extension:\/\//,
    /^safari-web-extension:\/\//,
  ],
  ignoreErrors: [
    ...base.ignoreErrors,
    "ResizeObserver loop limit exceeded",
    "ResizeObserver loop completed with undelivered notifications.",
    "Non-Error promise rejection captured",
    "Failed to fetch",
    "Load failed",
    "NetworkError when attempting to fetch resource.",
  ],
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
