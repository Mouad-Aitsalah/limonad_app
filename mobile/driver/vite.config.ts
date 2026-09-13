import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// PHASE 5A.1 - "9. IMPORTS PARTAGÉS": the shell lives under mobile/driver/,
// two levels below the repo root, so it can import the already-validated
// lib/offline/driver-pos/** modules without copying a single file.
const repoRoot = path.resolve(__dirname, "..", "..");

// PHASE 5A.1 - "10. INTERDICTION DES MODULES SERVEUR": a build-time guard,
// not just a convention. lib/offline/driver-pos/** is pure client code by
// design (no Prisma, no next/headers, no server-only), so nothing the shell
// legitimately needs should ever match these patterns - if one does, that is
// exactly the mistake this plugin exists to catch before it ships in an APK.
const FORBIDDEN_SPECIFIER_PATTERNS: RegExp[] = [
  /^server-only$/,
  /^next(\/|$)/,
  /^@prisma\//,
  /(^|\/)lib\/server\//,
  /(^|\/)lib\/generated\/prisma(\/|$)/,
];

function forbidServerImports(): Plugin {
  return {
    name: "comdis-forbid-server-imports",
    enforce: "pre",
    resolveId(source) {
      if (FORBIDDEN_SPECIFIER_PATTERNS.some((pattern) => pattern.test(source))) {
        throw new Error(
          `[comdis-forbid-server-imports] Le shell chauffeur ne doit jamais importer de module serveur : "${source}"`,
        );
      }
      return null;
    },
  };
}

export default defineConfig({
  root: __dirname,
  plugins: [forbidServerImports(), react()],
  resolve: {
    alias: {
      "@": repoRoot,
    },
  },
  server: {
    fs: {
      // Vite restricts file serving to the project root by default - this
      // project's root (mobile/driver) is a subdirectory of the repo, so
      // reading lib/offline/driver-pos/** at dev time needs an explicit
      // allow-list entry for the repo root itself.
      allow: [repoRoot],
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
  },
});
