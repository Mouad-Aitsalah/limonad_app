import { cn } from "@/lib/utils";

/**
 * "AS" monogram shown in the reference design. Vector approximation drawn for
 * the login page: replace the body of this component (or render the official
 * logo file instead) as soon as the final artwork is available.
 */
function LoginLogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 72 64" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="as-green" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0b9a55" />
          <stop offset="1" stopColor="#12b886" />
        </linearGradient>
        <linearGradient id="as-teal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#19c3a0" />
          <stop offset="1" stopColor="#0aa5b4" />
        </linearGradient>
      </defs>
      {/* A */}
      <path
        d="M6 54 L24 6 L44 54"
        fill="none"
        stroke="url(#as-green)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2 42 C16 40 30 36 48 41"
        fill="none"
        stroke="url(#as-green)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* S */}
      <path
        d="M66 22 C60 12 40 14 42 26 C44 37 66 34 66 46 C66 58 44 58 38 50"
        fill="none"
        stroke="url(#as-teal)"
        strokeWidth="6.5"
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
      <LoginLogoMark className={cn(stacked ? "h-14 w-16" : "h-14 w-16")} />
      <div className="leading-tight">
        <p
          className={cn(
            "font-semibold tracking-[0.04em]",
            stacked ? "text-xl" : "text-2xl",
            light ? "text-white" : "text-[#0c4a43]",
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
