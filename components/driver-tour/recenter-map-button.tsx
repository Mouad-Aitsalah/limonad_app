"use client";

import { LocateFixed } from "lucide-react";

export function RecenterMapButton({
  active,
  disabled,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? "Position GPS indisponible" : "Recentrer sur ma position"}
      className={[
        "flex h-12 w-12 items-center justify-center rounded-full border bg-background/95 shadow-[0_12px_26px_rgba(15,23,42,0.16)] backdrop-blur transition",
        active
          ? "border-emerald-500/40 text-emerald-700"
          : "border-border/70 text-foreground hover:bg-background",
        disabled ? "cursor-not-allowed opacity-55" : "",
      ].join(" ")}
      aria-label="Recentrer sur moi"
    >
      <LocateFixed className="h-5 w-5" />
    </button>
  );
}
