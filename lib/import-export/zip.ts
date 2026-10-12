import { unzipSync, zipSync, type Zippable } from "fflate";

/**
 * ZIP archives of the product export / import (data file + photos/), built and
 * read IN THE BROWSER - never sent whole to the server (a Vercel request is
 * limited to a few MB): the browser extracts the photos and uploads them in
 * small batches. Pure functions over bytes, so they are tested in Node too.
 *
 * Safety when reading an archive coming from outside:
 *   - an entry path is normalised ("\" -> "/") and REFUSED when absolute
 *     ("/x", "C:/x"), when it contains ".." or an empty / "." segment, or
 *     control characters - nothing is ever written to a disk anyway, but such
 *     a path is a sign of a malicious archive and is reported, not matched;
 *   - entries larger than the allowed size are not even decompressed (the
 *     declared size is checked before inflating, against zip bombs);
 *   - folders, macOS metadata (__MACOSX/, ._*) are ignored.
 */

/** Largest archive accepted by the import page. */
export const MAX_ZIP_BYTES = 300 * 1024 * 1024;
/** Most entries read from one archive. */
export const MAX_ZIP_ENTRIES = 20_000;
/** Largest data file (xlsx / csv) inside an archive. */
export const MAX_DATA_FILE_BYTES = 50 * 1024 * 1024;

/** Normalised archive path, or null when the path is unsafe. */
export function safeArchivePath(raw: string): string | null {
  const path = raw.replace(/\\/g, "/");
  if (!path || path.startsWith("/") || /^[A-Za-z]:/.test(path)) return null;
  if (/[\u0000-\u001f\u007f]/.test(path)) return null;
  const segments = path.split("/");
  if (segments.some((segment, index) => segment === ".." || segment === "." || (segment === "" && index < segments.length - 1))) {
    return null;
  }
  return path;
}

export type ArchiveContent = {
  /** Safe file entries, by normalised path (exact case kept). */
  files: Map<string, Uint8Array>;
  /** Paths refused as unsafe. */
  unsafe: string[];
  /** Entries skipped because larger than allowed (path + declared size). */
  tooLarge: Array<{ path: string; size: number }>;
};

/**
 * Reads an archive. `maxEntryBytes(path)` gives the largest size allowed for an
 * entry (e.g. 2 MB for a photo, more for the data file); bigger entries are
 * listed in `tooLarge` without being decompressed.
 */
export function readArchive(bytes: Uint8Array, maxEntryBytes: (path: string) => number): ArchiveContent {
  if (bytes.length > MAX_ZIP_BYTES) throw new Error("Archive trop volumineuse (300 Mo maximum).");
  const unsafe: string[] = [];
  const tooLarge: Array<{ path: string; size: number }> = [];
  let entries = 0;
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(bytes, {
      filter: (file) => {
        if (file.name.endsWith("/")) return false; // folder
        const path = safeArchivePath(file.name);
        if (!path) {
          unsafe.push(file.name);
          return false;
        }
        const name = path.split("/").pop() ?? "";
        if (path.startsWith("__MACOSX/") || name.startsWith("._")) return false;
        entries += 1;
        if (entries > MAX_ZIP_ENTRIES) throw new Error(`Archive avec trop de fichiers (${MAX_ZIP_ENTRIES} maximum).`);
        if (file.originalSize > maxEntryBytes(path)) {
          tooLarge.push({ path, size: file.originalSize });
          return false;
        }
        return true;
      },
    });
  } catch (error) {
    const message = error instanceof Error && /maximum/.test(error.message) ? error.message : "Archive ZIP illisible ou endommagée.";
    throw new Error(message);
  }
  const files = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(raw)) {
    const path = safeArchivePath(name);
    if (!path) continue;
    // the declared size could lie: re-check the real one
    if (data.length > maxEntryBytes(path)) {
      tooLarge.push({ path, size: data.length });
      continue;
    }
    files.set(path, data);
  }
  return { files, unsafe, tooLarge };
}

/** Builds an archive; photos (already compressed formats) are stored, the data file is deflated. */
export function buildArchive(entries: ReadonlyArray<{ path: string; data: Uint8Array; compress?: boolean }>): Uint8Array {
  const zippable: Zippable = {};
  for (const entry of entries) {
    const path = safeArchivePath(entry.path);
    if (!path) throw new Error(`Chemin d'archive invalide : ${entry.path}`);
    zippable[path] = [entry.data, { level: entry.compress ? 6 : 0 }];
  }
  return zipSync(zippable);
}

/** Finds an entry case-insensitively (an archive edited on another system may change the case). */
export function findArchiveEntry(files: ReadonlyMap<string, Uint8Array>, path: string): Uint8Array | undefined {
  const exact = files.get(path);
  if (exact) return exact;
  const wanted = path.toLowerCase();
  for (const [name, data] of files) if (name.toLowerCase() === wanted) return data;
  return undefined;
}
