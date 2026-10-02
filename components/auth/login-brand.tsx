import { cn } from "@/lib/utils";

/**
 * "AS" monogram of the AITSALAH STORE design reference: a bold "A" whose
 * crossbar sweeps into a rounded "S". Vector redraw made for the login page -
 * swap the body of this component (or render the official logo file) once
 * the final artwork is available.
 */
function LoginLogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 70" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="as-leg" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#0a8f58" />
          <stop offset="1" stopColor="#10c99a" />
        </linearGradient>
        <linearGradient id="as-swoosh" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#18c394" />
          <stop offset="1" stopColor="#0b8a5a" />
        </linearGradient>
        <linearGradient id="as-s" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0b9a62" />
          <stop offset="1" stopColor="#066a47" />
        </linearGradient>
      </defs>
      {/* A: thick left leg to the apex, thinner right leg */}
      <path
        d="M10 60 L30 8 L50 44"
        fill="none"
        stroke="url(#as-leg)"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* crossbar swoosh running into the S */}
      <path d="M4 54 L16 40 L52 38 L58 47 L32 48 Z" fill="url(#as-swoosh)" />
      {/* S */}
      <path
        d="M72 22 C70 10 48 12 47 26 C46 38 72 36 72 50 C72 64 48 64 42 54"
        fill="none"
        stroke="url(#as-s)"
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type LoginBrandProps = {
  /** "light": white text (on the navy panel). "dark": dark text (on the card). */
  tone?: "light" | "dark";
  /** Stacked and centered (form card) or inline (left panel header). */
  layout?: "inline" | "stacked";
  className?: string;
};

/** Logo mark + AITSALAH STORE / COMDIS MANAGER names. */
export function LoginBrand({ tone = "dark", layout = "inline", className }: LoginBrandProps) {
  const stacked = layout === "stacked";
  const light = tone === "light";

  return (
    <div
      role="img"
      aria-label="AITSALAH STORE - COMDIS MANAGER"
      className={cn("flex items-center gap-4", stacked && "flex-col gap-2 text-center", className)}
    >
      <LoginLogoMark className={cn(stacked ? "h-[4.25rem] w-[4.75rem]" : "h-14 w-16")} />
      <div className="leading-tight">
        <p
          className={cn(
            "font-semibold tracking-[0.04em]",
            stacked ? "text-xl" : "text-2xl",
            light ? "text-white" : "text-[#0a6b4f]",
          )}
        >
          AITSALAH STORE
        </p>
        <p
          className={cn(
            "mt-1 font-medium tracking-[0.3em]",
            stacked ? "text-[11px]" : "text-sm",
            light ? "text-white/75" : "text-slate-500",
          )}
        >
          COMDIS MANAGER
        </p>
      </div>
    </div>
  );
}
