import type { NextConfig } from "next";

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

export default nextConfig;
