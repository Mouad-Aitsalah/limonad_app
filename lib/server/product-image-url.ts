import "server-only";

/**
 * ÉTAPE PERF POS 1 - "IMAGES PRODUITS": Product.imageUrl is either a normal,
 * already-lightweight external URL (the "URL de l'image" field - see
 * components/produits/product-form-stock.tsx's own handleUrlChange) or a raw
 * base64 data: URI embedded directly in that same text column when a photo
 * was uploaded from a device (that file's readFileAsDataUrl - up to 2 MB
 * binary, ~2.7 MB once base64-encoded, no resizing/compression). That data:
 * URI, sent as-is inside a POS context's `products` array (up to 500 rows in
 * getDriverPosContext), is what made /driver/pos's RSC payload ~4.7 MB - see
 * the perf audit this étape acts on.
 *
 * This changes NOTHING about how images are stored (no migration, no schema
 * change): a data: URI is replaced, only in what gets sent to the client, by
 * a short, versioned link to a dedicated route
 * (app/api/products/[id]/image/route.ts) that decodes and streams those SAME
 * bytes from that SAME column - fetched only when a browser actually needs
 * that one image (a visible product card), never eagerly for all 500 at
 * once. An already-lightweight external URL is passed through unchanged -
 * nothing to gain by proxying it, and it may already sit behind a CDN.
 *
 * `updatedAt` is folded into the link (`?v=<timestamp>`) so the browser can
 * cache the route's response aggressively (`immutable`, see that route's own
 * doc comment) without ever risking a stale photo after a re-upload: editing
 * the product changes its `updatedAt`, which changes the URL itself.
 */
export function toLightweightProductImageUrl(
  productId: string,
  imageUrl: string | null,
  updatedAt: Date,
): string | null {
  if (!imageUrl) return null;
  if (!imageUrl.startsWith("data:")) return imageUrl;
  return `/api/products/${productId}/image?v=${updatedAt.getTime()}`;
}
