"use client";

/**
 * Driver-scoped error boundary. The driver is on a phone in the field and
 * cannot debug anything - so this is deliberately simpler and more direct
 * than the generic boundary: one large "recharger" action, no reference
 * codes competing for attention. Still reports the exception to Sentry and
 * never shows a stack trace or a raw `error.message`.
 */
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function DriverError({
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
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        color: "#0f172a",
        background: "#f8fafc",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: "22rem" }}>
        <h1 style={{ fontSize: "1.2rem", fontWeight: 700, margin: 0 }}>
          Un problème est survenu
        </h1>
        <p style={{ marginTop: "0.75rem", color: "#475569", fontSize: "0.95rem" }}>
          Rechargez la page pour continuer votre tournée.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            marginTop: "1.75rem",
            width: "100%",
            padding: "0.85rem 1rem",
            borderRadius: "0.75rem",
            border: "none",
            background: "#0f172a",
            color: "#ffffff",
            fontSize: "1rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Recharger
        </button>
      </div>
    </div>
  );
}
