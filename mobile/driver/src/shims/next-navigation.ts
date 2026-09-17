/**
 * INTÉGRATION POS SHELL - PHASE 1 (restauration) - ÉTAPE 21: aliased in
 * vite.config.ts to replace "next/navigation", same controlled-exception
 * pattern already used for "next/image"/"next/link" (see those shims' own
 * doc comments) - the ONE Next-specific import driver-clients-view.tsx needs
 * (`useRouter()`, called unconditionally per Rules of Hooks, only to call
 * `router.push` for "Faire une vente" when the caller doesn't inject its own
 * `onCreateSale`). The shell always injects `onCreateSale` (see
 * DriverClientsScreen.tsx), so `push` here is never actually reached in
 * practice - this only exists so the unconditional hook call has something
 * real to resolve against instead of crashing the whole build.
 *
 * TypeScript itself never sees this file when checking driver-clients-
 * view.tsx: `tsc -p mobile/driver/tsconfig.json` resolves "next/navigation"
 * via ordinary node_modules walk-up to the REAL @types/next package at the
 * repo root (same reasoning as next-link.tsx's own doc comment) - only
 * Vite's bundler, at actual build/runtime, redirects the import here. This
 * shim's own shape therefore never needs to structurally match Next's real
 * AppRouterInstance type.
 */
export function useRouter() {
  return {
    push(href: string) {
      console.warn(
        `[shell] next/navigation router.push(${JSON.stringify(href)}) called with no real router - this should be unreachable (DriverClientsView always receives onCreateSale on this shell).`,
      );
    },
  };
}
