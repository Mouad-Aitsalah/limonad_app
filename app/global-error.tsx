"use client";

/**
 * Root error boundary. Renders when an error escapes the root layout itself
 * (so it must provide its own <html>/<body>). Reports the exception to
 * Sentry and shows a fixed, non-technical message - never a stack trace or a
 * raw `error.message`, only the opaque `error.digest`.
 */
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "#f8fafc",
          color: "#0f172a",
        }}
      >
        <div style={{ textAlign: "center", padding: "2rem", maxWidth: "26rem" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>
            Une erreur est survenue
          </h1>
          <p style={{ marginTop: "0.75rem", color: "#475569", fontSize: "0.925rem" }}>
            Le problème a été signalé automatiquement. Vous pouvez réessayer.
          </p>
          {error.digest ? (
            <p style={{ marginTop: "1rem", color: "#94a3b8", fontSize: "0.75rem" }}>
              Référence&nbsp;: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: "1.5rem",
              padding: "0.5rem 1.25rem",
              borderRadius: "0.5rem",
              border: "1px solid #cbd5e1",
              background: "#ffffff",
              color: "#0f172a",
              fontSize: "0.9rem",
              cursor: "pointer",
            }}
          >
            Réessayer
          </button>
        </div>
      </body>
    </html>
  );
}
