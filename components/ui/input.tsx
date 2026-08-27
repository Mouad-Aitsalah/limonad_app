import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-11 w-full min-w-0 rounded-2xl border border-input/90 bg-white/88 px-4 py-2 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] transition-[border-color,box-shadow,background-color] outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/12 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/40 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-4 aria-invalid:ring-destructive/12",
        className
      )}
      {...props}
    />
  )
}

export { Input }
