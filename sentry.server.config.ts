/**
 * Sentry init for the Node.js server runtime (route handlers, server
 * components, `onRequestError`). Loaded from `instrumentation.ts`.
 *
 * 4Q.4A foundation: DSN-only, no source maps, no tracing, strict scrubbing.
 */
import * as Sentry from "@sentry/nextjs";

import { commonSentryInit } from "@/lib/sentry-options";

Sentry.init({
  ...commonSentryInit(),
  profilesSampleRate: 0,
});
