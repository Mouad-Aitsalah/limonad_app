import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// PHASE 5A.1 - "9. IMPORTS PARTAGÉS": the shell lives under mobile/driver/,
// two levels below the repo root, so it can import the already-validated
// lib/offline/driver-pos/** modules without copying a single file.
const repoRoot = path.resolve(__dirname, "..", "..");

// INTÉGRATION POS SHELL - the shell also reuses components/products/
// product-media.tsx (and everything that depends on it) UNCHANGED, whose
// only Next-specific import is "next/image" - aliased below to a local
// <img>-based shim (src/shims/next-image.tsx). This is the ONE deliberate,
// controlled exception to the guard below - never a general opt-out.
const nextImageShimPath = path.resolve(__dirname, "src/shims/next-image.tsx");

// PHASE 1 "RESTAURATION DU POS CHAUFFEUR" - ÉTAPE 1: components/driver-pos/
// driver-pos-view.tsx's own single Next-specific import is "next/link" (one
// back-link, hidden below `lg` and therefore never visible on this shell's
// phone-only viewport) - aliased below to a plain <a>-based shim
// (src/shims/next-link.tsx), same controlled-exception pattern as
// "next/image" above. driver-pos-view.tsx itself is NOT imported by the
// shell yet at this step - this only makes it RESOLVABLE by Vite/TypeScript
// once a later step does.
const nextLinkShimPath = path.resolve(__dirname, "src/shims/next-link.tsx");

// PHASE 5A.1 - "10. INTERDICTION DES MODULES SERVEUR": a build-time guard,
// not just a convention. lib/offline/driver-pos/** is pure client code by
// design (no Prisma, no next/headers, no server-only), so nothing the shell
// legitimately needs should ever match these patterns - if one does, that is
// exactly the mistake this plugin exists to catch before it ships in an APK.
// "next/image" and "next/link" are explicitly exempted (see the two shim
// paths above) - every other next/* import (next/navigation, next/headers,
// next/server, next/dynamic, bare "next", ...) stays forbidden.
const FORBIDDEN_SPECIFIER_PATTERNS: RegExp[] = [
  /^server-only$/,
  /^next$/,
  /^next\/(?!image$|link$)/,
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
  plugins: [forbidServerImports(), react(), tailwindcss()],
  resolve: {
    alias: {
      "next/image": nextImageShimPath,
      "next/link": nextLinkShimPath,
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
