/**
 * PHASE 5A.1 - "14. API BASE URL". The shell's own origin (https://localhost
 * on Android) is never where the Next.js app lives, so every fetch must be
 * absolute against this base - never `fetch("/api/...")`, which would
 * target the shell's own origin instead of the real API. No secret belongs
 * here: this is bundled into the built JS as plain text either way.
 */
export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL || "https://limonad-app.vercel.app";

export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}
