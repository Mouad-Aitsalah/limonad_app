import Image from "next/image";

import { cn } from "@/lib/utils";

type LoginBrandProps = {
  /** "light": white text (on the navy panel). "dark": navy text (on the card). */
  tone?: "light" | "dark";
  /** Stacked and centered (form card) or inline (left panel header). */
  layout?: "inline" | "stacked";
  className?: string;
};

/**
 * Official COMDIS logo (the app icon already shipped in /public/icons) with the
 * AITSALAH STORE / COMDIS MANAGER names. The logo file is reused as-is.
 */
export function LoginBrand({ tone = "dark", layout = "inline", className }: LoginBrandProps) {
  const stacked = layout === "stacked";

  return (
    <div
      className={cn(
        "flex items-center gap-3",
        stacked && "flex-col gap-3 text-center",
        className,
      )}
    >
      <Image
        src="/icons/icon-192.png"
        alt="Logo AITSALAH STORE"
        width={192}
        height={192}
        priority
        className={cn(
          "rounded-2xl shadow-[0_8px_20px_rgba(0,0,0,0.18)]",
          stacked ? "h-16 w-16" : "h-12 w-12",
        )}
      />
      <div className={cn("leading-tight", stacked && "space-y-1")}>
        <p
          className={cn(
            "font-semibold tracking-wide",
            stacked ? "text-lg" : "text-base",
            tone === "light" ? "text-white" : "text-[#102B4E]",
          )}
        >
          AITSALAH STORE
        </p>
        <p
          className={cn(
            "text-xs font-semibold tracking-[0.28em]",
            tone === "light" ? "text-white/70" : "text-[#00966D]",
          )}
        >
          COMDIS MANAGER
        </p>
      </div>
    </div>
  );
}
