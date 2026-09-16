import { Wifi, WifiOff } from "lucide-react";

/**
 * INTÉGRATION POS SHELL - visual equivalent of components/driver-pos/
 * network-status-badge.tsx, sourced from the shell's OWN online signal
 * (already tracked in App.tsx) instead of that component's useNetworkState
 * hook, which probes a relative, cookie-only /api/auth/session - not
 * meaningful from this shell's cross-origin perspective. Same markup/classes
 * otherwise, so it looks identical.
 */
export function ShellNetworkBadge({ online }: { online: boolean }) {
  return (
    <span
      className={
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium " +
        (online
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-amber-200 bg-amber-50 text-amber-700")
      }
    >
      {online ? (
        <Wifi aria-hidden="true" className="h-3.5 w-3.5" />
      ) : (
        <WifiOff aria-hidden="true" className="h-3.5 w-3.5" />
      )}
      {online ? "Connecte" : "Hors connexion"}
    </span>
  );
}
