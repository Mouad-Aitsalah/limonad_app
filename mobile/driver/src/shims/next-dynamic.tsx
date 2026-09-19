import * as React from "react";

/**
 * ÉTAPE 28B/28D - aliased in vite.config.ts to replace "next/dynamic", same
 * controlled-exception pattern as "next/image"/"next/link"/"next/navigation"
 * (see those shims' own doc comments) - the one Next-specific import
 * components/driver-tour/driver-tour-view.tsx needs to lazy-load
 * DriverTourMap (the Google Maps canvas).
 *
 * ÉTAPE 28D: 28B rendered only the `loading` placeholder here because the map
 * was not wired yet; it now really loads the component. Reproduces exactly the
 * two things a call site relies on: the loader is only invoked on the client
 * (this shell has no server render, so `ssr: false` is inherent), and the
 * `loading` placeholder shows until the module has arrived, then the loaded
 * component replaces it with the same props. The dynamic chunk is a plain
 * Vite/Rollup code-split module bundled INTO the APK - it loads offline too;
 * what needs the network is Google's own script, which DriverTourMap requests
 * itself (and handles failing - see lib/google-maps-loader.ts).
 *
 * Still shared by every `next/dynamic` call site the shell bundles (today only
 * DriverTourView), so it stays a generic implementation: nothing here knows
 * about the map.
 *
 * TypeScript never sees this file when checking driver-tour-view.tsx (same
 * reasoning as next-link.tsx's own doc comment: `tsc` resolves "next/dynamic"
 * to the real Next types) - only Vite's bundler redirects the import here.
 */
type DynamicOptions = {
  loading?: () => React.ReactNode;
  ssr?: boolean;
};

type LoadedModule<P> = React.ComponentType<P> | { default: React.ComponentType<P> };

export default function dynamic<P extends object>(
  loader: () => Promise<LoadedModule<P>>,
  options?: DynamicOptions,
): React.ComponentType<P> {
  // Shared by every instance: the module is imported once, later mounts render
  // the component immediately instead of flashing the placeholder again.
  let cached: React.ComponentType<P> | null = null;

  return function ShellDynamic(props: P) {
    const [Loaded, setLoaded] = React.useState<React.ComponentType<P> | null>(() => cached);

    React.useEffect(() => {
      if (cached) return;
      let active = true;
      loader()
        .then((module) => {
          const component = "default" in module ? module.default : module;
          cached = component;
          if (active) setLoaded(() => component);
        })
        .catch((error) => {
          // A bundled chunk that cannot load is a build defect, not a runtime
          // condition to recover from - keep the placeholder and say why.
          console.error("[shell] next/dynamic chunk failed to load", error);
        });
      return () => {
        active = false;
      };
    }, []);

    if (!Loaded) return <>{options?.loading ? options.loading() : null}</>;
    return <Loaded {...props} />;
  };
}
