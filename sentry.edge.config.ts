/**
 * Sentry init for the Edge runtime. COMDIS runs everything on the Node.js
 * runtime today (no route or proxy declares `runtime = "edge"`), so this
 * config is effectively inert - kept only so `instrumentation.ts`'s
 * conditional `import("./sentry.edge.config")` always resolves if Next ever
 * bundles an edge chunk.
 *
 * 4Q.4A foundation: DSN-only, no source maps, no tracing, strict scrubbing.
 */
import * as Sentry from "@sentry/nextjs";

import { commonSentryInit } from "@/lib/sentry-options";

Sentry.init({
  ...commonSentryInit(),
});
