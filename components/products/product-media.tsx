"use client";

import * as React from "react";
import Image from "next/image";
import { Capacitor } from "@capacitor/core";
import { Package2 } from "lucide-react";

import { getNativeMediaAuth } from "@/lib/native-media-auth";
import { cn } from "@/lib/utils";

const passthroughImageLoader = ({ src }: { src: string }) => src;

// FIX ANDROID POS PHOTOS - resolved once per distinct product-image URL and
// reused by every card that renders it (grid tile + cart thumbnail + "just
// added" toast all commonly show the same product) - see native-media-auth.ts's
// own doc comment for why this fetch (Bearer-authenticated, cross-origin) is
// necessary at all on native. Never revoked: the handful of distinct photos
// a driver scrolls through in one POS session is small and short-lived
// (the WebView process itself is what eventually reclaims it), and revoking
// on a single card's unmount could break another still-mounted card showing
// the very same photo.
const nativeImageBlobCache = new Map<string, Promise<string | null>>();

function resolveNativeAbsoluteUrl(imageUrl: string): string {
  if (/^https?:\/\//i.test(imageUrl) || imageUrl.startsWith("data:")) return imageUrl;
  const { apiBaseUrl } = getNativeMediaAuth();
  return apiBaseUrl ? `${apiBaseUrl}${imageUrl}` : imageUrl;
}

function fetchNativeImageBlobUrl(imageUrl: string): Promise<string | null> {
  const absoluteUrl = resolveNativeAbsoluteUrl(imageUrl);
  const cached = nativeImageBlobCache.get(absoluteUrl);
  if (cached) return cached;

  const { token } = getNativeMediaAuth();
  const promise = fetch(absoluteUrl, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
    .then((response) => (response.ok ? response.blob() : null))
    .then((blob) => (blob ? URL.createObjectURL(blob) : null))
    .catch(() => null);
  nativeImageBlobCache.set(absoluteUrl, promise);
  return promise;
}

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
  // FIX ANDROID POS PHOTOS - a data: URI is already self-contained (no
  // network request, no origin, nothing to authenticate) and works
  // identically everywhere, so it always takes the plain <img> path below -
  // only a real /api/products/[id]/image link needs the native fetch.
  const needsNativeFetch = Capacitor.isNativePlatform() && !imageUrl.startsWith("data:");
  const [nativeSrc, setNativeSrc] = React.useState<string | null>(null);
  const observedRef = React.useRef<HTMLDivElement>(null);
  const [inView, setInView] = React.useState(false);

  // Same laziness the plain <img loading="lazy"> gives the web for free:
  // only start the (Bearer-authenticated) fetch once this card's own
  // placeholder actually scrolls near the viewport, never for all ~500
  // products the moment the POS grid mounts.
  React.useEffect(() => {
    if (!needsNativeFetch) return;
    const el = observedRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setInView(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [needsNativeFetch]);

  React.useEffect(() => {
    if (!needsNativeFetch || !inView) return;
    let cancelled = false;
    void fetchNativeImageBlobUrl(imageUrl).then((blobUrl) => {
      if (cancelled) return;
      if (blobUrl) setNativeSrc(blobUrl);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [needsNativeFetch, inView, imageUrl]);

  if (failed) return <>{placeholder}</>;

  if (needsNativeFetch) {
    return (
      <div ref={observedRef} className="absolute inset-0">
        {nativeSrc ? (
          <Image
            loader={passthroughImageLoader}
            unoptimized
            src={nativeSrc}
            alt={alt}
            fill
            sizes={sizes}
            decoding="async"
            onError={() => setFailed(true)}
            className={cn(fit === "cover" ? "object-cover" : "object-contain p-3", imageClassName)}
          />
        ) : null}
      </div>
    );
  }

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
