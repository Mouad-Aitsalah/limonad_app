"use client";

import * as React from "react";
import { createPortal } from "react-dom";

import { Input } from "@/components/ui/input";
import {
  ACCOUNT_SUGGESTION_LIMIT,
  autocompleteAfterInput,
  CLOSED_AUTOCOMPLETE,
  filterAccountsByPrefix,
  findExactAccountIndex,
  handleAutocompleteKey,
  type AutocompleteState,
} from "@/lib/account-autocomplete";
import { cn } from "@/lib/utils";
import type { AccountingAccountOptionDto } from "@/types/accounting";

type AccountCodeInputProps = {
  value: string;
  onValueChange: (next: string) => void;
  /** The chart of accounts the page already loaded - filtered in memory, no request per keystroke. */
  accounts: AccountingAccountOptionDto[];
  /** Ref of the underlying <input> (the entry table's own Enter-to-next-field navigation uses it). */
  inputRef?: (node: HTMLInputElement | null) => void;
  /** Called for every key the autocomplete did not consume (Enter -> next field stays in the parent). */
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  invalid?: boolean;
  placeholder?: string;
  className?: string;
};

type PopupPosition = { left: number; top: number; width: number; maxHeight: number; above: boolean };

const POPUP_MIN_WIDTH = 288;

/**
 * "N° compte" field with prefix autocomplete (accounts whose number starts
 * with what is typed). Each instance owns its own open/active state, so every
 * entry line works independently. The list is rendered in a portal with fixed
 * positioning: the entry table scrolls horizontally on small screens
 * (overflow-x-auto), which would clip an absolutely positioned list.
 */
export function AccountCodeInput({
  value,
  onValueChange,
  accounts,
  inputRef,
  onKeyDown,
  invalid,
  placeholder,
  className,
}: AccountCodeInputProps) {
  const listboxId = React.useId();
  const [state, setState] = React.useState<AutocompleteState>(CLOSED_AUTOCOMPLETE);
  const [position, setPosition] = React.useState<PopupPosition | null>(null);
  const inputNodeRef = React.useRef<HTMLInputElement | null>(null);
  const popupRef = React.useRef<HTMLDivElement | null>(null);

  const { items, total } = React.useMemo(
    () => filterAccountsByPrefix(accounts, value),
    [accounts, value],
  );
  const visible = state.open && value.trim() !== "";

  function setInputNode(node: HTMLInputElement | null) {
    inputNodeRef.current = node;
    inputRef?.(node);
  }

  function choose(account: AccountingAccountOptionDto) {
    onValueChange(account.code);
    setState(CLOSED_AUTOCOMPLETE);
    inputNodeRef.current?.focus();
  }

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const next = event.target.value;
    onValueChange(next);
    const { items: nextItems } = filterAccountsByPrefix(accounts, next);
    setState(autocompleteAfterInput(next.trim() !== "", findExactAccountIndex(nextItems, next)));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    const outcome = handleAutocompleteKey(
      visible ? state : { ...state, open: false },
      event.key,
      items.length,
    );
    setState(outcome.state);
    if (outcome.select) {
      const chosen = items[state.activeIndex];
      if (chosen) {
        event.preventDefault();
        choose(chosen);
        return;
      }
    }
    if (outcome.consumed) {
      event.preventDefault();
      return;
    }
    onKeyDown?.(event);
  }

  // Position under the field (above it when there is no room), kept in sync
  // with scrolling (page or the table's own horizontal scroll) and resizing.
  React.useLayoutEffect(() => {
    if (!visible) return;
    function place() {
      const input = inputNodeRef.current;
      if (!input) return;
      const rect = input.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const width = Math.min(Math.max(rect.width, POPUP_MIN_WIDTH), viewportWidth - 16);
      const left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8));
      const spaceBelow = viewportHeight - rect.bottom - 12;
      const spaceAbove = rect.top - 12;
      const above = spaceBelow < 180 && spaceAbove > spaceBelow;
      const maxHeight = Math.max(120, Math.min(320, above ? spaceAbove : spaceBelow));
      setPosition({
        left,
        width,
        above,
        maxHeight,
        top: above ? rect.top - 4 : rect.bottom + 4,
      });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [visible, items.length]);

  // Click / tap outside the field and its list closes it.
  React.useEffect(() => {
    if (!visible) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (inputNodeRef.current?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      setState(CLOSED_AUTOCOMPLETE);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [visible]);

  // Keep the highlighted suggestion in view while navigating with the arrows.
  React.useEffect(() => {
    if (!visible || state.activeIndex < 0) return;
    document
      .getElementById(`${listboxId}-opt-${state.activeIndex}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [visible, state.activeIndex, listboxId]);

  const activeId =
    visible && state.activeIndex >= 0 && state.activeIndex < items.length
      ? `${listboxId}-opt-${state.activeIndex}`
      : undefined;

  return (
    <>
      <Input
        ref={setInputNode}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={(event) => {
          if (popupRef.current?.contains(event.relatedTarget as Node | null)) return;
          setState(CLOSED_AUTOCOMPLETE);
        }}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={visible}
        aria-controls={visible ? listboxId : undefined}
        aria-activedescendant={activeId}
        aria-invalid={invalid}
        autoComplete="off"
        placeholder={placeholder}
        className={className}
      />
      {visible && position && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popupRef}
              style={{
                position: "fixed",
                left: position.left,
                width: position.width,
                top: position.top,
                transform: position.above ? "translateY(-100%)" : undefined,
                maxHeight: position.maxHeight,
              }}
              className="z-[1000] flex flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg ring-1 ring-black/5"
            >
              {items.length === 0 ? (
                <p role="status" className="px-3 py-3 text-sm text-muted-foreground">
                  Aucun compte ne commence par «&nbsp;{value.trim()}&nbsp;».
                </p>
              ) : (
                <>
                  <ul
                    id={listboxId}
                    role="listbox"
                    aria-label="Comptes correspondants"
                    className="min-h-0 flex-1 overflow-y-auto py-1"
                  >
                    {items.map((account, index) => {
                      const active = index === state.activeIndex;
                      return (
                        <li
                          key={account.id}
                          id={`${listboxId}-opt-${index}`}
                          role="option"
                          aria-selected={active}
                          // keep the focus in the field: selecting must not blur it
                          onMouseDown={(event) => event.preventDefault()}
                          onMouseMove={() =>
                            setState((current) =>
                              current.activeIndex === index ? current : { open: true, activeIndex: index },
                            )
                          }
                          onClick={() => choose(account)}
                          className={cn(
                            "flex cursor-pointer items-baseline gap-2 px-3 py-2 text-sm",
                            active ? "bg-emerald-50 text-foreground" : "text-foreground/90",
                          )}
                        >
                          <span className="shrink-0 font-semibold tabular-nums">{account.code}</span>
                          <span aria-hidden="true" className="shrink-0 text-muted-foreground">
                            —
                          </span>
                          <span className="min-w-0 truncate" title={account.name}>
                            {account.name}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {total > ACCOUNT_SUGGESTION_LIMIT ? (
                    <p className="border-t border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
                      {ACCOUNT_SUGGESTION_LIMIT} premiers résultats sur {total} - continuez à saisir
                      pour affiner.
                    </p>
                  ) : null}
                </>
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
