/**
 * Product photos in the exports / imports - pure and isomorphic.
 *
 * Product.imageUrl holds either a `data:image/...;base64,...` URI (a photo
 * uploaded in the app - the product form accepts any image up to 2 MB) or an
 * http(s) URL. The application route that serves a stored photo
 * (/api/products/[id]/image) requires a session of the SAME organisation: it is
 * never a public resource, so such a URL is never exported nor accepted at
 * import - the photo itself travels in the ZIP instead.
 *
 * The real format of an image is read from its first bytes (magic numbers),
 * never trusted from a file name or a declared MIME type.
 */

/** Same limit as the product form (components/produits/product-form-stock.tsx). */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

export type PhotoMime = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

export const PHOTO_EXTENSIONS: Record<PhotoMime, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** The image format from the bytes themselves; null when it is none of the accepted ones. */
export function detectPhotoMime(bytes: Uint8Array): PhotoMime | null {
  const at = (index: number) => bytes[index];
  if (bytes.length >= 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 && at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a) {
    return "image/png";
  }
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (bytes.length >= 6) {
    const head = String.fromCharCode(at(0), at(1), at(2), at(3), at(4), at(5));
    if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  }
  if (bytes.length >= 12) {
    const riff = String.fromCharCode(at(0), at(1), at(2), at(3));
    const webp = String.fromCharCode(at(8), at(9), at(10), at(11));
    if (riff === "RIFF" && webp === "WEBP") return "image/webp";
  }
  return null;
}

// --- base64 (no Buffer / atob dependency: works in the browser, Node and the tests) ---

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = new Map([...ALPHABET].map((char, index) => [char, index]));

export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += ALPHABET[(triple >> 18) & 63] + ALPHABET[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? ALPHABET[(triple >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? ALPHABET[triple & 63] : "=";
  }
  return out;
}

/** null when the text is not valid base64. */
export function base64ToBytes(base64: string): Uint8Array | null {
  const clean = base64.replace(/\s+/g, "");
  if (clean.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return null;
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const out = new Uint8Array((clean.length / 4) * 3 - padding);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      ((LOOKUP.get(clean[i]) ?? 0) << 18) |
      ((LOOKUP.get(clean[i + 1]) ?? 0) << 12) |
      ((LOOKUP.get(clean[i + 2]) ?? 0) << 6) |
      (LOOKUP.get(clean[i + 3]) ?? 0);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

/** Bytes -> the data: URI stored in Product.imageUrl (the format the product form produces). */
export function photoDataUrl(bytes: Uint8Array, mime: PhotoMime): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

export type PhotoCheck = { ok: true; mime: PhotoMime; bytes: Uint8Array } | { ok: false; message: string };

/** Validates raw photo bytes: an accepted image format (by content) and at most 2 MB. */
export function checkPhotoBytes(bytes: Uint8Array): PhotoCheck {
  if (bytes.length === 0) return { ok: false, message: "Image vide." };
  if (bytes.length > MAX_PHOTO_BYTES) {
    return { ok: false, message: `Image trop volumineuse (${(bytes.length / 1024 / 1024).toFixed(1)} Mo, maximum 2 Mo).` };
  }
  const mime = detectPhotoMime(bytes);
  if (!mime) return { ok: false, message: "Format d'image non pris en charge (PNG, JPEG, WebP ou GIF attendu) ou fichier illisible." };
  return { ok: true, mime, bytes };
}

/** A data: URI sent by the browser: decoded and re-checked from its CONTENT (server side). */
export function checkPhotoDataUrl(dataUrl: string): PhotoCheck {
  const match = /^data:([^;,]+);base64,([\s\S]*)$/.exec(dataUrl);
  if (!match) return { ok: false, message: "Image illisible (data URI base64 attendue)." };
  // a quick bound before decoding: base64 is 4/3 of the bytes
  if (match[2].length > Math.ceil((MAX_PHOTO_BYTES * 4) / 3) + 8) {
    return { ok: false, message: "Image trop volumineuse (maximum 2 Mo)." };
  }
  const bytes = base64ToBytes(match[2]);
  if (!bytes) return { ok: false, message: "Image illisible (base64 invalide)." };
  return checkPhotoBytes(bytes);
}

/** The bytes of a stored data: URI photo (export); null for an URL or an unreadable value. */
export function storedPhotoBytes(imageUrl: string | null | undefined): { mime: PhotoMime; bytes: Uint8Array } | null {
  if (!imageUrl || !imageUrl.startsWith("data:")) return null;
  const match = /^data:[^;,]*;base64,([\s\S]*)$/.exec(imageUrl);
  if (!match) return null;
  const bytes = base64ToBytes(match[1]);
  if (!bytes) return null;
  const mime = detectPhotoMime(bytes);
  return mime ? { mime, bytes } : null;
}

/**
 * An external photo URL that can be exported / imported as is: http(s) with a
 * host, and NOT the application's own protected photo route - that URL needs a
 * session of the source organisation and is never a public resource.
 */
export function isPortablePhotoUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (!url.hostname) return false;
  return !/^\/api\/(products|produits)\//i.test(url.pathname);
}

/**
 * The archive path of a product's photo: photos/<reference made file-safe>.<ext>.
 * Characters outside [A-Za-z0-9._-] become "_" (accents dropped), so "REF/001 é"
 * gives "photos/REF_001_e.jpg"; two references that would give the same name get
 * "_2", "_3"... The link to the product is the `photo` column of the data file,
 * never this name, so the cleaning can never mix two products up.
 */
export function photoArchivePath(reference: string, mime: PhotoMime, used: Set<string>): string {
  const base =
    reference
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/^[._]+|[._]+$/g, "")
      .slice(0, 80) || "photo";
  const extension = PHOTO_EXTENSIONS[mime];
  let candidate = `photos/${base}.${extension}`;
  let counter = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `photos/${base}_${counter}.${extension}`;
    counter += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}
