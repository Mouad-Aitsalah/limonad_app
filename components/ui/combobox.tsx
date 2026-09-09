"use client"

import * as React from "react"
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { CheckIcon, ChevronDownIcon, SearchIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

const Combobox = ComboboxPrimitive.Root

function ComboboxInputGroup({
  className,
  ...props
}: ComboboxPrimitive.InputGroup.Props) {
  return (
    <ComboboxPrimitive.InputGroup
      data-slot="combobox-input-group"
      className={cn("relative", className)}
      {...props}
    />
  )
}

function ComboboxInput({ className, ...props }: ComboboxPrimitive.Input.Props) {
  return (
    <>
      <SearchIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
      <ComboboxPrimitive.Input
        data-slot="combobox-input"
        className={cn(
          "h-9 w-full rounded-lg border border-input bg-transparent py-2 pr-8 pl-9 text-sm whitespace-nowrap transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      />
      <ComboboxPrimitive.Icon
        render={
          <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        }
      />
    </>
  )
}

function ComboboxClear({ className, ...props }: ComboboxPrimitive.Clear.Props) {
  return (
    <ComboboxPrimitive.Clear
      data-slot="combobox-clear"
      aria-label="Effacer la selection"
      className={cn(
        "absolute top-1/2 right-8 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
        className
      )}
      {...props}
    >
      <XIcon className="pointer-events-none h-3.5 w-3.5" />
    </ComboboxPrimitive.Clear>
  )
}

function ComboboxContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "start",
  alignOffset = 0,
  ...props
}: ComboboxPrimitive.Popup.Props &
  Pick<ComboboxPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        className="isolate z-[1000]"
      >
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          className={cn(
            // Height hugs the options (auto when few, capped + internal scroll
            // when many) - never a fixed tall box. Width tracks the anchor but
            // is clamped so it can't overflow a narrow screen on mobile.
            "relative isolate z-[1000] max-h-[min(20rem,var(--available-height))] w-(--anchor-width) max-w-[calc(100vw-1rem)] min-w-56 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        >
          <ComboboxPrimitive.List className="scroll-my-1 p-1">{children}</ComboboxPrimitive.List>
        </ComboboxPrimitive.Popup>
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  )
}

function ComboboxItem({ className, children, ...props }: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        // Hover AND keyboard both drive data-highlighted (Base UI
        // highlightItemOnHover) - one clear background for the targeted row;
        // data-selected keeps a lighter marker on the current choice.
        "relative flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1.5 pr-8 pl-2 text-sm outline-hidden transition-colors select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[selected]:bg-accent/60 data-[selected]:font-medium data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className
      )}
      {...props}
    >
      {children}
      <ComboboxPrimitive.ItemIndicator className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
        <CheckIcon className="pointer-events-none size-4" />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  )
}

function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      // Base UI keeps this node mounted even when there ARE items (it only
      // nulls its children) for screen-reader announcements. Padding must be
      // conditional on it having content, otherwise every dropdown carries a
      // ~48px blank band above the first option.
      className={cn(
        "text-center text-sm text-muted-foreground [&:not(:empty)]:px-3 [&:not(:empty)]:py-6",
        className
      )}
      {...props}
    />
  )
}

export {
  Combobox,
  ComboboxInputGroup,
  ComboboxInput,
  ComboboxClear,
  ComboboxContent,
  ComboboxItem,
  ComboboxEmpty,
}
