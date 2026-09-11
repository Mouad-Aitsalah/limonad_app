"use client";

import * as React from "react";
import { ChevronDown, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DailyInvoiceUserOptionDto } from "@/types/daily-invoice";

type DailyInvoicesUserFilterProps = {
  options: DailyInvoiceUserOptionDto[];
  /** Selected user ids (OR filter). Empty = all users. */
  value: string[];
  onChange: (next: string[]) => void;
};

/**
 * Multi-select "Utilisateur" filter for Factures journalières. No shared
 * multi-select primitive exists in the project, so this is a thin
 * DropdownMenu of checkbox items (which keep the menu open on toggle by
 * default). Options are the current organisation's users only.
 */
export function DailyInvoicesUserFilter({ options, value, onChange }: DailyInvoicesUserFilterProps) {
  const selected = new Set(value);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  }

  const label =
    value.length === 0
      ? "Tous les utilisateurs"
      : value.length === 1
        ? options.find((option) => option.id === value[0])?.name ?? "1 utilisateur"
        : `${value.length} utilisateurs`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="outline" className="w-full justify-between font-normal" />
        }
      >
        <span className="flex min-w-0 items-center gap-2">
          <Users aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{label}</span>
        </span>
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-64 overflow-y-auto">
        <DropdownMenuLabel>Utilisateur</DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => onChange([])}
          disabled={value.length === 0}
          className="text-muted-foreground"
        >
          Tous les utilisateurs
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {options.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">Aucun utilisateur.</p>
        ) : (
          options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.id}
              checked={selected.has(option.id)}
              onCheckedChange={() => toggle(option.id)}
            >
              {option.name}
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
