import * as React from "react";

/**
 * INTÉGRATION POS SHELL - aliased in vite.config.ts to replace "next/image"
 * so components/products/product-media.tsx (and everything that depends on
 * it - ProductCard, ProductGrid, MobileSelectedProduct) can be imported into
 * this Vite project UNCHANGED. product-media.tsx already uses
 * `unoptimized` + a passthrough `loader`, i.e. it never relied on Next's own
 * image optimization pipeline - visually this plain <img> is identical to
 * what Next's own Image renders for that file. `fill` reproduces Next's own
 * behavior (absolutely positioned, filling the nearest `position: relative`
 * ancestor) since product-media.tsx's wrapper div already sets that up.
 */

type NextImageShimProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src" | "width" | "height"> & {
  src: string;
  alt: string;
  fill?: boolean;
  sizes?: string;
  // Next-only props - accepted so callers don't need to change, ignored
  // here since a plain <img> has no equivalent.
  loader?: unknown;
  unoptimized?: boolean;
  priority?: boolean;
  quality?: number;
};

// Next-only props (loader/unoptimized/priority/quality) are destructured out
// on purpose so they never land in `...rest` (a plain <img> would otherwise
// receive them as invalid DOM attributes) - see this file's own doc comment
// for why dropping them is safe here.
/* eslint-disable @typescript-eslint/no-unused-vars */
export default function Image({
  src,
  alt,
  fill,
  sizes,
  style,
  loader,
  unoptimized,
  priority,
  quality,
  ...rest
}: NextImageShimProps) {
  /* eslint-enable @typescript-eslint/no-unused-vars */
  return (
    <img
      src={src}
      alt={alt}
      sizes={sizes}
      style={fill ? { position: "absolute", inset: 0, height: "100%", width: "100%", ...style } : style}
      {...rest}
    />
  );
}
