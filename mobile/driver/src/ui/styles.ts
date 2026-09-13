import type * as React from "react";

/** Shared inline-style tokens for every screen - kept as one small module so
 *  the four screens don't each redefine the same card/button look (see this
 *  task's own "PAS DE DUPLICATION MASSIVE"). No CSS framework: this stays a
 *  lean POC shell, same choice as Phase 5A.1. */
export const styles: Record<string, React.CSSProperties> = {
  page: {
    fontFamily: "system-ui, -apple-system, sans-serif",
    maxWidth: 480,
    margin: "0 auto",
    padding: "24px 16px 48px",
    color: "#0f172a",
    background: "#f8fafc",
    minHeight: "100vh",
    boxSizing: "border-box",
  },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  title: { fontSize: 22, fontWeight: 700, margin: 0 },
  badge: { fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 999 },
  badgeOnline: { background: "#dcfce7", color: "#166534" },
  badgeOffline: { background: "#fef3c7", color: "#92400e" },
  card: {
    background: "#ffffff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.06)",
  },
  cardTitle: { fontSize: 14, fontWeight: 600, margin: "0 0 10px", textTransform: "uppercase", letterSpacing: 0.4 },
  muted: { fontSize: 13, color: "#64748b", margin: "0 0 8px" },
  definitionList: { margin: "0 0 12px", display: "flex", flexDirection: "column", gap: 6 },
  row: { display: "flex", justifyContent: "space-between", fontSize: 14 },
  rowLabel: { color: "#64748b" },
  rowValue: { fontWeight: 600, textAlign: "right" },
  form: { display: "flex", flexDirection: "column", gap: 8 },
  input: {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #cbd5e1",
    fontSize: 14,
  },
  primaryButton: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "none",
    background: "#2563eb",
    color: "#ffffff",
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
  },
  secondaryButton: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#0f172a",
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
  },
  actionButton: {
    padding: "16px 14px",
    borderRadius: 14,
    border: "1px solid #e2e8f0",
    background: "#ffffff",
    color: "#0f172a",
    fontWeight: 600,
    fontSize: 15,
    textAlign: "left",
    cursor: "pointer",
    width: "100%",
  },
  buttonRow: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 },
  error: { color: "#b91c1c", fontSize: 13, margin: "0 0 8px" },
  banner: {
    fontSize: 13,
    padding: "8px 12px",
    borderRadius: 10,
    marginBottom: 12,
  },
  bannerWarning: { background: "#fef3c7", color: "#92400e" },
  bannerInfo: { background: "#e0f2fe", color: "#075985" },
  pre: {
    background: "#0f172a",
    color: "#e2e8f0",
    fontSize: 11,
    padding: 12,
    borderRadius: 10,
    overflowX: "auto",
    margin: 0,
  },
  saleRow: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "10px 0",
    borderBottom: "1px solid #e2e8f0",
  },
};

export function statusDotColor(online: boolean): string {
  return online ? "#16a34a" : "#d97706";
}
