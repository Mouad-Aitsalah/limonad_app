import * as React from "react";

/**
 * INTÉGRATION POS SHELL - PHASE 1 (restauration du POS chauffeur original) -
 * "ÉTAPE 1 : importer components/driver-pos/driver-pos-view.tsx dans le
 * shell". Aliased in vite.config.ts to replace "next/link", exactly the same
 * controlled-exception pattern already used for "next/image" (see
 * next-image.tsx's own doc comment) - the ONE Next-specific import left in
 * driver-pos-view.tsx (a single back-link, `<Link href="/mobile">`, hidden
 * below the `lg` breakpoint and therefore never visible on this shell's
 * phone-only viewport - see driver-pos-view.tsx's own comment on that link).
 *
 * Reproduces ONLY what that one call site actually uses: `href`, `children`,
 * `className`, plus whatever other plain anchor attributes/handlers a caller
 * passes through. Next-only props (`prefetch`, `replace`, `scroll`,
 * `shallow`, `passHref`, `legacyBehavior`) are accepted so a caller doesn't
 * need to change, then dropped - this shell has no router, so client-side
 * navigation/prefetching has no equivalent here; a plain `<a href>` is
 * exactly what Next's own `<Link>` degrades to without its router context.
 */

type NextLinkShimProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  children?: React.ReactNode;
  // Next-only props - accepted so callers don't need to change, ignored
  // here since a plain <a> has no router-backed equivalent.
  prefetch?: unknown;
  replace?: boolean;
  scroll?: boolean;
  shallow?: boolean;
  passHref?: boolean;
  legacyBehavior?: boolean;
};

/* eslint-disable @typescript-eslint/no-unused-vars */
export default function Link({
  href,
  children,
  prefetch,
  replace,
  scroll,
  shallow,
  passHref,
  legacyBehavior,
  ...rest
}: NextLinkShimProps) {
  /* eslint-enable @typescript-eslint/no-unused-vars */
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}
