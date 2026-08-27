import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-2xl border border-transparent bg-clip-padding text-sm font-semibold whitespace-nowrap transition-all duration-200 outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-[linear-gradient(135deg,#173156_0%,#0f7a5d_100%)] text-primary-foreground shadow-[0_16px_30px_rgba(16,37,63,0.18)] hover:brightness-105",
        outline:
          "border-border bg-white/82 text-foreground hover:bg-[var(--surface-muted)] hover:text-foreground aria-expanded:bg-[var(--surface-muted)] aria-expanded:text-foreground",
        secondary:
          "bg-secondary text-secondary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] hover:bg-[color-mix(in_srgb,var(--secondary)_82%,white_18%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-white/70 hover:text-foreground aria-expanded:bg-white/70 aria-expanded:text-foreground",
        destructive:
          "bg-[color:rgb(220_76_95_/_0.12)] text-[var(--danger)] hover:bg-[color:rgb(220_76_95_/_0.18)] focus-visible:border-destructive/40 focus-visible:ring-destructive/20",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-11 gap-2 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-8 gap-1 rounded-xl px-3 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-9 gap-1.5 rounded-xl px-3.5 text-[0.82rem] has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-12 gap-2 px-5 text-[0.95rem] has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        icon: "size-11 rounded-2xl",
        "icon-xs":
          "size-8 rounded-xl [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-9 rounded-xl",
        "icon-lg": "size-12 rounded-2xl",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
