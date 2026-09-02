import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  // Wildcard patterns instead of specific IPs, so the dev server keeps
  // accepting requests from this machine's LAN address after it changes
  // (DHCP renewal, hotspot reconnect, different network) without ever
  // needing to hardcode a new one here. Dev-only - has no effect on
  // production builds.
  allowedDevOrigins: ["172.*.*.*", "192.168.*.*", "10.*.*.*"],
  turbopack: {
    root: process.cwd(),
  },
};

// 4Q.4A foundation: DSN-only. No auth token is set, so the Sentry bundler
// plugin never attempts a release creation or a source-map upload - source
// maps stay disabled explicitly on top of that. `org`/`project` are read
// from the environment when present (build-time only) but are optional here.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: true,
  telemetry: false,
  sourcemaps: { disable: true },
});
