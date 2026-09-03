/**
 * Company-logo upload rules, shared by the client form and the server route.
 *
 * The logo is stored as a `data:` URL in Organization.logoUrl (a text
 * column - the same persistence the product photos already use, never the
 * Vercel filesystem). Only raster images are allowed; SVG / HTML / JS /
 * anything else is rejected by the strict prefix check below.
 */

export const LOGO_ACCEPTED_MIME = ["image/png", "image/jpeg", "image/webp"] as const;
export type LogoMime = (typeof LOGO_ACCEPTED_MIME)[number];

/** Decoded byte ceiling. A logo lives in the layout payload of every page - keep it small. */
export const LOGO_MAX_BYTES = 512 * 1024; // 512 KB

export const LOGO_MAX_BYTES_LABEL = "512 Ko";

const LOGO_DATA_URL_RE =
  /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

/** Approximate decoded size of a base64 payload without allocating a Buffer. */
export function estimateBase64Bytes(base64: string): number {
  const len = base64.length;
  if (len === 0) return 0;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((len * 3) / 4) - padding;
}

export type LogoValidation = { ok: true; mime: LogoMime } | { ok: false; message: string };

/**
 * Validates a `data:image/(png|jpeg|webp);base64,...` string: strict MIME
 * prefix, non-empty payload, decoded size <= LOGO_MAX_BYTES. Never accepts
 * SVG, HTML, JS or a bare URL.
 */
export function validateLogoDataUrl(value: string): LogoValidation {
  const match = LOGO_DATA_URL_RE.exec(value.trim());
  if (!match) {
    return { ok: false, message: "Format non autorisé. Utilisez un PNG, JPG ou WEBP." };
  }
  const base64 = match[2];
  if (base64.length === 0) {
    return { ok: false, message: "Le fichier est vide." };
  }
  const bytes = estimateBase64Bytes(base64);
  if (bytes <= 0) {
    return { ok: false, message: "Le fichier est vide." };
  }
  if (bytes > LOGO_MAX_BYTES) {
    return { ok: false, message: `Le logo dépasse la taille maximale (${LOGO_MAX_BYTES_LABEL}).` };
  }
  const mime = `image/${match[1] === "jpeg" ? "jpeg" : match[1]}` as LogoMime;
  return { ok: true, mime };
}

/** Client-side pre-check on the picked File before it is read as a data URL. */
export function validateLogoFile(file: File): { ok: true } | { ok: false; message: string } {
  if (!(LOGO_ACCEPTED_MIME as readonly string[]).includes(file.type)) {
    return { ok: false, message: "Format non autorisé. Utilisez un PNG, JPG ou WEBP." };
  }
  if (file.size === 0) {
    return { ok: false, message: "Le fichier est vide." };
  }
  if (file.size > LOGO_MAX_BYTES) {
    return { ok: false, message: `Le logo dépasse la taille maximale (${LOGO_MAX_BYTES_LABEL}).` };
  }
  return { ok: true };
}

/** Reads a File to a base64 data URL (browser only). */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Lecture du fichier impossible."));
    reader.readAsDataURL(file);
  });
}
