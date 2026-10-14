"use client";

import * as React from "react";
import { ChevronDown, X, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type MultiSelectOption = {
  value: string;
  label: string;
  /** Short grey note after the label (e.g. « chauffeur »). */
  hint?: string;
  /** Options shown apart at the top of the list (e.g. « Sans fournisseur », « Non attribués »). */
  special?: boolean;
};

/** The trigger's text: the « all » label for an empty selection, the name for one, a count beyond. */
export function multiSelectSummary(
  options: readonly MultiSelectOption[],
  value: readonly string[],
  allLabel: string,
  plural: string,
): string {
  if (value.length === 0) return allLabel;
  if (value.length === 1) return options.find((option) => option.value === value[0])?.label ?? `1 ${plural}`;
  return `${value.length} ${plural} sélectionnés`;
}

/** Keeps the order of the options (stable URL, stable chips) and drops unknown or repeated values. */
export function normalizeSelection(options: readonly MultiSelectOption[], value: readonly string[]): string[] {
  const wanted = new Set(value);
  return options.filter((option) => wanted.has(option.value)).map((option) => option.value);
}

/** The query-string value of a selection: sorted, without repeats ("" for an empty selection = all). */
export function selectionParam(value: readonly string[]): string {
  return [...new Set(value)].sort().join(",");
}

const CHIPS_SHOWN = 6;

/**
 * Multiple selection over a list of options: a drop-down of checkboxes (the menu stays open while ticking),
 * « Tout sélectionner » / « Tout désélectionner », and the current selection shown as removable chips under
 * the control. An EMPTY selection means « all » (the label says so); the parent decides what it sends.
 */
export function MultiSelectFilter({
  label,
  icon: Icon,
  options,
  value,
  onChange,
  allLabel,
  plural,
  emptyText = "Aucune option.",
  className,
}: {
  label: string;
  icon?: LucideIcon;
  options: readonly MultiSelectOption[];
  value: readonly string[];
  onChange: (next: string[]) => void;
  allLabel: string;
  /** Plural noun for the count (« utilisateurs », « fournisseurs »). */
  plural: string;
  emptyText?: string;
  className?: string;
}) {
  const selected = new Set(value);
  const special = options.filter((option) => option.special);
  const regular = options.filter((option) => !option.special);
  const chips = normalizeSelection(options, value);
  const allSelected = options.length > 0 && chips.length === options.length;

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(normalizeSelection(options, [...next]));
  }

  const item = (option: MultiSelectOption) => (
    <DropdownMenuCheckboxItem key={option.value} checked={selected.has(option.value)} onCheckedChange={() => toggle(option.value)}>
      <span className="truncate">{option.label}</span>
      {option.hint ? <span className="ml-auto pl-2 text-xs text-muted-foreground">{option.hint}</span> : null}
    </DropdownMenuCheckboxItem>
  );

  return (
    <div className={cn("space-y-2", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button type="button" variant="outline" aria-label={label} className="w-full justify-between font-normal max-lg:h-10" />}
        >
          <span className="flex min-w-0 items-center gap-2">
            {Icon ? <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" /> : null}
            <span className="truncate">{multiSelectSummary(options, chips, allLabel, plural)}</span>
          </span>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 w-72 overflow-y-auto">
          {/* Base UI's GroupLabel needs its Group (it throws outside of one). */}
          <DropdownMenuGroup>
            <DropdownMenuLabel>{label}</DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuItem closeOnClick={false} disabled={options.length === 0 || allSelected} onClick={() => onChange(options.map((option) => option.value))}>
            Tout sélectionner
          </DropdownMenuItem>
          <DropdownMenuItem closeOnClick={false} disabled={chips.length === 0} onClick={() => onChange([])}>
            Tout désélectionner
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {options.length === 0 ? <p className="px-2 py-1.5 text-sm text-muted-foreground">{emptyText}</p> : null}
          {special.map(item)}
          {special.length && regular.length ? <DropdownMenuSeparator /> : null}
          {regular.map(item)}
        </DropdownMenuContent>
      </DropdownMenu>

      {chips.length > 0 ? (
        <ul aria-label={`${label} : sélection`} className="flex flex-wrap gap-1.5">
          {chips.slice(0, CHIPS_SHOWN).map((id) => {
            const option = options.find((candidate) => candidate.value === id);
            return (
              <li key={id}>
                <span className="inline-flex max-w-[14rem] items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 py-0.5 pr-1 pl-2.5 text-xs font-medium text-emerald-800">
                  <span className="truncate">{option?.label ?? id}</span>
                  <button
                    type="button"
                    aria-label={`Retirer ${option?.label ?? id}`}
                    onClick={() => toggle(id)}
                    className="inline-flex size-4 items-center justify-center rounded-full text-emerald-700 hover:bg-emerald-100"
                  >
                    <X aria-hidden="true" className="size-3" />
                  </button>
                </span>
              </li>
            );
          })}
          {chips.length > CHIPS_SHOWN ? (
            <li className="inline-flex items-center px-1 text-xs text-muted-foreground">+{chips.length - CHIPS_SHOWN}</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
