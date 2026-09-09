"use client";

import * as React from "react";

import {
  Combobox,
  ComboboxClear,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
} from "@/components/ui/combobox";
import type { PosBankAccountOptionDto } from "@/types/operations-dto";

/**
 * Searchable "Compte bancaire" picker shown for a BANK_TRANSFER POS sale.
 * The list is the org's active 5141 accounts (preloaded in the POS context);
 * the caller stores only the chosen account id. Same shape/behaviour as the
 * purchases form's BankAccountCombobox.
 */
export function BankAccountCombobox({
  accounts,
  accountId,
  onChange,
  id,
}: {
  accounts: PosBankAccountOptionDto[];
  accountId: string;
  onChange: (accountId: string) => void;
  id?: string;
}) {
  const [query, setQuery] = React.useState("");
  const selected = accounts.find((account) => account.id === accountId) ?? null;
  const matching = React.useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("fr");
    if (!normalized) return accounts;
    return accounts.filter((account) =>
      `${account.code} ${account.name}`.toLocaleLowerCase("fr").includes(normalized),
    );
  }, [accounts, query]);

  return (
    <Combobox
      items={matching}
      filter={null}
      value={selected}
      onValueChange={(account) => onChange(account?.id ?? "")}
      inputValue={query}
      onInputValueChange={setQuery}
      itemToStringLabel={(account: PosBankAccountOptionDto | null) =>
        account ? `${account.code} — ${account.name}` : ""
      }
      isItemEqualToValue={(a: PosBankAccountOptionDto, b: PosBankAccountOptionDto) =>
        a.id === b.id
      }
    >
      <ComboboxInputGroup>
        <ComboboxInput
          id={id}
          placeholder={
            selected
              ? `${selected.code} — ${selected.name}`
              : "Rechercher un compte 5141 (code ou nom)"
          }
        />
        <ComboboxClear />
      </ComboboxInputGroup>
      <ComboboxContent>
        <ComboboxEmpty>Aucun compte 5141 actif trouvé.</ComboboxEmpty>
        {matching.map((account, index) => (
          <ComboboxItem key={account.id} value={account} index={index}>
            <div className="flex min-w-0 flex-col">
              <span className="font-medium">{account.code}</span>
              <span className="truncate text-xs text-muted-foreground">
                {account.name}
              </span>
            </div>
          </ComboboxItem>
        ))}
      </ComboboxContent>
    </Combobox>
  );
}
