"use client";

import * as React from "react";
import Image from "next/image";
import { Package2 } from "lucide-react";

import { cn } from "@/lib/utils";

const passthroughImageLoader = ({ src }: { src: string }) => src;

type ProductMediaProps = {
  imageUrl?: string | null;
  alt: string;
  className?: string;
  imageClassName?: string;
  placeholderClassName?: string;
  iconClassName?: string;
  fit?: "contain" | "cover";
  sizes?: string;
};

export function ProductMedia({
  imageUrl,
  alt,
  className,
  imageClassName,
  placeholderClassName,
  iconClassName,
  fit = "contain",
  sizes = "(max-width: 640px) 50vw, (max-width: 1280px) 33vw, 25vw",
}: ProductMediaProps) {
  const placeholder = (
    <div
      className={cn(
        "flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,#d1fae5,transparent_58%),linear-gradient(135deg,#ecfdf5_0%,#d1fae5_100%)] text-emerald-700",
        placeholderClassName,
      )}
    >
      <Package2 className={cn("h-8 w-8", iconClassName)} />
    </div>
  );

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[20px] border border-border/70 bg-[radial-gradient(circle_at_top,#d1fae5,transparent_58%),linear-gradient(135deg,#f0fdf4_0%,#dcfce7_100%)]",
        className,
      )}
    >
      {imageUrl ? (
        // ÉTAPE PERF POS 1 - "IMAGES PRODUITS": a product photo is now
        // fetched lazily from its own route (see
        // lib/server/product-image-url.ts) instead of being embedded inline
        // - that fetch can fail (offline, a dropped connection, a
        // stale/broken URL). ProductMediaImage falls back to the SAME
        // placeholder a product with no photo at all already shows - never a
        // browser broken-image icon. `key={imageUrl}` remounts it fresh
        // whenever the URL changes, so a different product's photo swapping
        // in never keeps showing the previous one's now-irrelevant failure -
        // no effect/ref needed to reset that state by hand.
        <ProductMediaImage
          key={imageUrl}
          imageUrl={imageUrl}
          alt={alt}
          sizes={sizes}
          fit={fit}
          imageClassName={imageClassName}
          placeholder={placeholder}
        />
      ) : (
        placeholder
      )}
    </div>
  );
}

function ProductMediaImage({
  imageUrl,
  alt,
  sizes,
  fit,
  imageClassName,
  placeholder,
}: {
  imageUrl: string;
  alt: string;
  sizes: string;
  fit: "contain" | "cover";
  imageClassName?: string;
  placeholder: React.ReactNode;
}) {
  const [failed, setFailed] = React.useState(false);
  if (failed) return <>{placeholder}</>;

  return (
    <Image
      loader={passthroughImageLoader}
      unoptimized
      src={imageUrl}
      alt={alt}
      fill
      sizes={sizes}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={cn(fit === "cover" ? "object-cover" : "object-contain p-3", imageClassName)}
    />
  );
}
