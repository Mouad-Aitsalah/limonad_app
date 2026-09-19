import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

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

// ÉTAPE 21: components/driver-clients/driver-clients-view.tsx's own single
// Next-specific import is "next/navigation"'s useRouter() (called
// unconditionally per Rules of Hooks, only to push to /driver/pos when a
// caller doesn't inject its own onCreateSale - the shell always does) -
// aliased below to a minimal useRouter() shim (src/shims/next-navigation.ts),
// same controlled-exception pattern as "next/image"/"next/link" above.
const nextNavigationShimPath = path.resolve(__dirname, "src/shims/next-navigation.ts");

// ÉTAPE 28B: components/driver-tour/driver-tour-view.tsx lazy-loads its Google
// Maps canvas through "next/dynamic" - aliased below to a shim that only ever
// renders the component's own `loading` placeholder (the map étape is later),
// same controlled-exception pattern as the three shims above.
const nextDynamicShimPath = path.resolve(__dirname, "src/shims/next-dynamic.tsx");

// PHASE 5A.1 - "10. INTERDICTION DES MODULES SERVEUR": a build-time guard,
// not just a convention. lib/offline/driver-pos/** is pure client code by
// design (no Prisma, no next/headers, no server-only), so nothing the shell
// legitimately needs should ever match these patterns - if one does, that is
// exactly the mistake this plugin exists to catch before it ships in an APK.
// "next/image", "next/link", "next/navigation" and "next/dynamic" are
// explicitly exempted (see the four shim paths above) - every other next/*
// import (next/headers, next/server, bare "next", ...) stays forbidden.
const FORBIDDEN_SPECIFIER_PATTERNS: RegExp[] = [
  /^server-only$/,
  /^next$/,
  /^next\/(?!image$|link$|navigation$|dynamic$)/,
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

// ÉTAPE 28D - the shared map code (lib/google-maps-loader.ts,
// components/driver-tour/driver-tour-map.tsx, ...) reads its two CLIENT-side
// Google Maps settings from `process.env.NEXT_PUBLIC_GOOGLE_MAPS_*` - a Next.js
// build-time substitution that does not exist in a Vite bundle (`process` is
// undefined in the WebView: the module would throw at load). Rather than fork
// those files, the exact same expressions are substituted here from the
// shell's own VITE_* variables (see .env.example). Only VITE_-prefixed
// variables are ever read (loadEnv's prefix filter) - never a server secret,
// and GOOGLE_MAPS_ROUTES_API_KEY (server-side Routes API) is not needed by the
// shell at all. Both values are public by nature (they end up in the JS the
// browser downloads, on the web app as well) - protect them with Google Cloud
// restrictions, not by hiding them. Unset -> "" -> the loader's own
// "not configured" path.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "VITE_");
  return {
  root: __dirname,
  plugins: [forbidServerImports(), react(), tailwindcss()],
  define: {
    "process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY": JSON.stringify(env.VITE_GOOGLE_MAPS_API_KEY ?? ""),
    "process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID": JSON.stringify(env.VITE_GOOGLE_MAPS_MAP_ID ?? ""),
  },
  resolve: {
    // ÉTAPE 28B: the repo root and this shell each install their own copy of
    // "sonner" (2.0.7 vs 2.0.8). Shared components under components/ resolve
    // it from the root, the shell's <Toaster/> from here - two separate toast
    // stores, so every toast() fired by a reused component (POS, Clients, Ma
    // tournee, ...) never reached the shell's Toaster. Dedupe forces ONE copy.
    dedupe: ["sonner"],
    alias: {
      "next/image": nextImageShimPath,
      "next/link": nextLinkShimPath,
      "next/navigation": nextNavigationShimPath,
      "next/dynamic": nextDynamicShimPath,
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
  };
});
