"use client";

import * as React from "react";

type Result<T> = { key: string; data?: T; error?: string };

/**
 * Loads one analysis from its API route and reloads when the URL (= the
 * filters) changes. `loading` is true from the moment the filters change until
 * the matching answer arrives; the PREVIOUS data stays available meanwhile (the
 * section dims it instead of flashing empty). A refused / failed request gives
 * a readable `error` and `retry()`. Stale answers (a previous filter combination
 * arriving late) are ignored.
 */
export function useAnalysisData<T>(url: string) {
  const [attempt, setAttempt] = React.useState(0);
  const [result, setResult] = React.useState<Result<T> | null>(null);
  const [lastData, setLastData] = React.useState<T | undefined>(undefined);
  const key = `${url}#${attempt}`;

  React.useEffect(() => {
    const controller = new AbortController();
    fetch(url, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as T & { message?: string };
        if (!response.ok) {
          const message =
            response.status === 403 || response.status === 401
              ? "Accès réservé aux administrateurs."
              : ((body as { message?: string }).message ?? "Impossible de charger les données.");
          setResult({ key, error: message });
          return;
        }
        setLastData(body);
        setResult({ key, data: body });
      })
      .catch((error: unknown) => {
        if ((error as { name?: string }).name === "AbortError") return;
        setResult({ key, error: "Impossible de charger les données. Vérifiez la connexion." });
      });
    return () => controller.abort();
  }, [url, key]);

  const loading = result?.key !== key;
  return {
    loading,
    data: result?.key === key ? result.data : undefined,
    /** The last answer received, even while a new one is loading. */
    lastData,
    error: result?.key === key ? result.error : undefined,
    retry: () => setAttempt((value) => value + 1),
  };
}
