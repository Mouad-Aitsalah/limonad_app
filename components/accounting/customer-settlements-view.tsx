"use client";

import * as React from "react";
import { ChevronDown, Users } from "lucide-react";
import { toast } from "sonner";

import { CustomerCombobox } from "@/components/pos/customer-combobox";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCustomerCode } from "@/lib/customer-code";
import { formatCurrency } from "@/lib/utils";
import type { CustomerDto } from "@/types/operations-dto";
import type { CustomerJournalDto } from "@/types/customer-settlement";

type SettlementMethod = "CASH" | "CHECK" | "BANK_TRANSFER";

const methodOptions: Array<{ value: SettlementMethod; label: string }> = [
  { value: "CASH", label: "Espèces" },
  { value: "CHECK", label: "Chèque" },
  { value: "BANK_TRANSFER", label: "Virement" },
];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("fr-FR");
}

export function CustomerSettlementsView() {
  const [customer, setCustomer] = React.useState<CustomerDto | null>(null);
  const [journal, setJournal] = React.useState<CustomerJournalDto | null>(null);
  const [loadingJournal, setLoadingJournal] = React.useState(false);

  // Display-only multi-select filter (empty = "Tous les utilisateurs").
  const [userFilter, setUserFilter] = React.useState<string[]>([]);

  const [amount, setAmount] = React.useState("");
  const [method, setMethod] = React.useState<SettlementMethod>("CASH");
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const idempotencyKeyRef = React.useRef(crypto.randomUUID());

  const debt = journal?.debt.debt ?? null;

  const loadJournal = React.useCallback(
    async (customerId: string, page: number, userIds: string[]) => {
      setLoadingJournal(true);
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: "20",
        });
        if (userIds.length > 0) params.set("userIds", userIds.join(","));
        const response = await fetch(
          `/api/customers/${customerId}/journal?${params.toString()}`,
          { cache: "no-store" },
        );
        const body = (await response.json()) as CustomerJournalDto & { message?: string };
        if (!response.ok || !body.debt) {
          toast.error(body.message ?? "Impossible de charger le compte du client.");
          return;
        }
        setJournal(body);
      } catch {
        toast.error("Impossible de charger le compte du client.");
      } finally {
        setLoadingJournal(false);
      }
    },
    [],
  );

  function handleSelectCustomer(next: CustomerDto | null) {
    setCustomer(next);
    // Nothing of the previous client must linger.
    setJournal(null);
    setUserFilter([]);
    setAmount("");
    setFormError(null);
    idempotencyKeyRef.current = crypto.randomUUID();
    if (next) void loadJournal(next.id, 1, []);
  }

  function handleUserFilterChange(next: string[]) {
    setUserFilter(next);
    if (customer) void loadJournal(customer.id, 1, next);
  }

  const parsedAmount = Number(amount.replace(",", "."));
  const hasValidAmount =
    amount.trim() !== "" && Number.isFinite(parsedAmount) && parsedAmount > 0;
  const soldeApres =
    debt !== null && hasValidAmount ? Math.max(0, debt - parsedAmount) : debt;
  const noDebt = debt !== null && debt <= 0;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    if (!customer) {
      setFormError("Veuillez sélectionner un client.");
      return;
    }
    if (debt === null) return;

    if (!hasValidAmount) {
      setFormError("Le montant du règlement doit être strictement positif.");
      return;
    }
    if (parsedAmount > debt) {
      setFormError("Le montant du règlement dépasse le solde du client.");
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      const response = await fetch(`/api/customers/${customer.id}/settlements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: parsedAmount,
          method,
          idempotencyKey: idempotencyKeyRef.current,
        }),
      });
      const body = (await response.json()) as {
        settlement?: unknown;
        message?: string;
        fieldErrors?: Record<string, string>;
      };
      if (!response.ok || !body.settlement) {
        setFormError(
          body.fieldErrors?.amount ??
            body.message ??
            "Impossible d'enregistrer le règlement.",
        );
        return;
      }
      toast.success(`Règlement de ${formatCurrency(parsedAmount)} enregistré.`);
      setAmount("");
      idempotencyKeyRef.current = crypto.randomUUID();
      // The filter is display-only: reload the current selection so the new
      // settlement shows immediately, without dropping the active filter.
      await loadJournal(customer.id, 1, userFilter);
    } catch {
      setFormError("Impossible d'enregistrer le règlement.");
    } finally {
      setSubmitting(false);
    }
  }

  const pagination = journal?.pagination;
  const journalUsers = journal?.users ?? [];

  return (
    <div className="space-y-6">
      {/* --- Filtres : Client + Utilisateurs --- */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-[0_10px_30px_rgba(15,23,42,0.06)] lg:p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:max-w-2xl">
          <div className="min-w-0">
            <CustomerCombobox
              value={customer}
              onChange={handleSelectCustomer}
              initialSuggestions={[]}
              label="Client"
              placeholder="Rechercher par nom, code ou téléphone"
            />
          </div>
          <div className="min-w-0 space-y-2">
            <Label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Users aria-hidden="true" className="h-3.5 w-3.5" />
              Utilisateurs
            </Label>
            <UserMultiSelect
              users={journalUsers}
              selected={userFilter}
              onChange={handleUserFilterChange}
              disabled={!customer}
            />
          </div>
        </div>

        {customer ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">Code client</p>
              <p className="font-medium text-foreground">
                {formatCustomerCode(customer.code)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Nom client</p>
              <p className="font-medium text-foreground">{customer.name}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Téléphone</p>
              <p className="font-medium text-foreground">{customer.phone || "—"}</p>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            Veuillez sélectionner un client.
          </p>
        )}
      </div>

      {customer ? (
        <>
          {/* --- Solde à régler (dette métier, jamais affectée par le filtre) --- */}
          <div className="rounded-2xl border border-border bg-card p-5 shadow-[0_10px_30px_rgba(15,23,42,0.06)] lg:p-6">
            <p className="text-sm font-medium text-muted-foreground">Solde à régler</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-foreground">
              {debt === null ? "…" : formatCurrency(debt)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Dette métier fiable (ventes à crédit − avoirs − règlements validés).
              Non affectée par le filtre utilisateur.
            </p>
          </div>

          {/* --- Nouveau règlement --- */}
          <div className="rounded-2xl border border-border bg-card p-5 shadow-[0_10px_30px_rgba(15,23,42,0.06)] lg:p-6">
            <h2 className="font-heading text-lg font-semibold text-foreground">
              Nouveau règlement
            </h2>

            <div className="mt-3 grid gap-1 text-sm sm:grid-cols-2 sm:max-w-md">
              <div>
                <span className="text-xs text-muted-foreground">Client</span>
                <p className="font-medium text-foreground">{customer.name}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Solde actuel</span>
                <p className="font-medium tabular-nums text-foreground">
                  {debt === null ? "…" : formatCurrency(debt)}
                </p>
              </div>
            </div>

            {noDebt ? (
              <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
                Ce client n&apos;a aucune créance à régler.
              </p>
            ) : (
              <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
                <div className="grid gap-4 sm:grid-cols-2 lg:max-w-xl">
                  <div className="space-y-1.5">
                    <Label htmlFor="rc-amount">Montant</Label>
                    <Input
                      id="rc-amount"
                      type="number"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      value={amount}
                      disabled={submitting}
                      aria-invalid={Boolean(formError)}
                      className="h-11"
                      onChange={(event) => {
                        setAmount(event.target.value);
                        if (formError) setFormError(null);
                      }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rc-method">Mode</Label>
                    <Select
                      value={method}
                      onValueChange={(value) => setMethod(value as SettlementMethod)}
                    >
                      <SelectTrigger id="rc-method" className="h-11 w-full">
                        <SelectValue>
                          {methodOptions.find((option) => option.value === method)?.label}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {methodOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="max-w-xs space-y-1.5 rounded-xl border border-border bg-muted/20 px-4 py-3 text-sm tabular-nums">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Solde actuel</span>
                    <span className="font-medium">
                      {debt === null ? "…" : formatCurrency(debt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Montant règlement</span>
                    <span className="font-medium">
                      {formatCurrency(hasValidAmount ? parsedAmount : 0)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-t border-border pt-1.5 font-semibold text-foreground">
                    <span>Solde après règlement</span>
                    <span>{soldeApres === null ? "—" : formatCurrency(soldeApres)}</span>
                  </div>
                </div>

                {formError ? <p className="text-xs text-destructive">{formError}</p> : null}

                <Button type="submit" size="lg" disabled={submitting || loadingJournal}>
                  {submitting ? "Enregistrement..." : "Valider le règlement"}
                </Button>
              </form>
            )}
          </div>

          {/* --- Opérations du client --- */}
          <div className="rounded-2xl border border-border bg-card p-5 shadow-[0_10px_30px_rgba(15,23,42,0.06)] lg:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-heading text-lg font-semibold text-foreground">
                Opérations du client
              </h2>
              {journal?.account ? (
                <span className="text-sm text-muted-foreground">
                  Compte auxiliaire {journal.account.code} — {journal.account.name}
                </span>
              ) : null}
            </div>

            {journal && journal.notAttributable.count > 0 ? (
              <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Certaines écritures historiques de ce compte auxiliaire ne peuvent pas
                être rattachées avec certitude à ce client
                {" "}
                ({journal.notAttributable.count} opération
                {journal.notAttributable.count > 1 ? "s" : ""})
                {" "}: elles appartiennent à un autre client partageant le même compte,
                ou ne portent aucun lien client fiable (écriture manuelle). Elles sont
                exclues du tableau et des totaux ci-dessous.
              </p>
            ) : null}

            {journal && journal.operations.length > 0 ? (
              <>
                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  <div className="rounded-xl border border-border bg-muted/20 px-4 py-3">
                    <p className="text-xs text-muted-foreground">Total débit attribué</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums">
                      {formatCurrency(journal.totals.debit)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/20 px-4 py-3">
                    <p className="text-xs text-muted-foreground">Total crédit attribué</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums">
                      {formatCurrency(journal.totals.credit)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/20 px-4 py-3">
                    <p className="text-xs text-muted-foreground">Solde comptable attribué</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums">
                      {formatCurrency(journal.totals.balance)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      débit − crédit des opérations rattachées à ce client uniquement
                    </p>
                  </div>
                </div>

                {debt !== null &&
                Math.abs(debt - journal.totals.balance) > 0.005 ? (
                  <p className="mt-3 rounded-xl bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    Le solde à régler ({formatCurrency(debt)}) — la dette métier fiable —
                    reste la référence. Le solde comptable attribué (
                    {formatCurrency(journal.totals.balance)}) ne porte que sur les écritures
                    rattachables du Journal, une partie de l&apos;historique comptable ancien
                    n&apos;ayant pas été rétro-alimentée.
                  </p>
                ) : null}

                {userFilter.length > 0 ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Filtre utilisateur actif — {journal.operations.length} opération
                    {journal.operations.length > 1 ? "s" : ""} affichée
                    {journal.operations.length > 1 ? "s" : ""} sur cette page. La colonne
                    « Solde » et les totaux restent calculés sur le journal complet.
                  </p>
                ) : null}

                <div className="mt-4 overflow-x-auto rounded-xl border border-border">
                  <Table className="min-w-[900px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>N° opération</TableHead>
                        <TableHead>N° compte</TableHead>
                        <TableHead>Désignation</TableHead>
                        <TableHead>Utilisateur</TableHead>
                        <TableHead className="text-right">Débit</TableHead>
                        <TableHead className="text-right">Crédit</TableHead>
                        <TableHead className="text-right">Solde</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {journal.operations.map((op) => (
                        <TableRow key={op.id}>
                          <TableCell className="tabular-nums">{formatDate(op.date)}</TableCell>
                          <TableCell className="font-medium tabular-nums">
                            {op.operationNumber}
                          </TableCell>
                          <TableCell className="tabular-nums">{op.accountCode}</TableCell>
                          <TableCell className="whitespace-normal">
                            {op.label.trim() || (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {op.createdByUserName ?? (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {op.debit > 0 ? formatCurrency(op.debit) : "-"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {op.credit > 0 ? formatCurrency(op.credit) : "-"}
                          </TableCell>
                          <TableCell
                            className={
                              "text-right font-medium tabular-nums" +
                              (op.balance < 0 ? " text-destructive" : "")
                            }
                          >
                            {formatCurrency(op.balance)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {pagination && pagination.pageCount > 1 ? (
                  <div className="mt-4 flex items-center justify-end gap-2 text-sm">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={loadingJournal || pagination.page <= 1}
                      onClick={() =>
                        void loadJournal(customer.id, pagination.page - 1, userFilter)
                      }
                    >
                      ← Précédent
                    </Button>
                    <span className="tabular-nums text-muted-foreground">
                      Page {pagination.page} / {pagination.pageCount}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={loadingJournal || pagination.page >= pagination.pageCount}
                      onClick={() =>
                        void loadJournal(customer.id, pagination.page + 1, userFilter)
                      }
                    >
                      Suivant →
                    </Button>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="mt-4 rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                {loadingJournal
                  ? "Chargement…"
                  : userFilter.length > 0
                    ? "Aucune opération pour les utilisateurs sélectionnés."
                    : "Aucune opération comptable pour ce client."}
              </p>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * Multi-select "Utilisateur" filter. Empty selection = "Tous les
 * utilisateurs" (default). Options are only the users who authored an
 * operation of the current client (already organisation-scoped server-side).
 */
function UserMultiSelect({
  users,
  selected,
  onChange,
  disabled,
}: {
  users: Array<{ id: string; name: string }>;
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const selectedSet = new Set(selected);
  const selectedNames = users
    .filter((user) => selectedSet.has(user.id))
    .map((user) => user.name);

  const label =
    selectedNames.length === 0
      ? "Tous les utilisateurs"
      : selectedNames.length <= 2
        ? selectedNames.join(", ")
        : `${selectedNames.length} utilisateurs sélectionnés`;

  function toggle(id: string) {
    onChange(
      selectedSet.has(id) ? selected.filter((value) => value !== id) : [...selected, id],
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className="flex h-11 w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="truncate">{label}</span>
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 w-[min(20rem,calc(100vw-2rem))] overflow-y-auto">
        <DropdownMenuCheckboxItem
          checked={selected.length === 0}
          onCheckedChange={() => onChange([])}
          closeOnClick={false}
        >
          Tous les utilisateurs
        </DropdownMenuCheckboxItem>
        {users.length > 0 ? <DropdownMenuSeparator /> : null}
        {users.map((user) => (
          <DropdownMenuCheckboxItem
            key={user.id}
            checked={selectedSet.has(user.id)}
            onCheckedChange={() => toggle(user.id)}
            closeOnClick={false}
          >
            {user.name}
          </DropdownMenuCheckboxItem>
        ))}
        {users.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            Aucune opération à filtrer.
          </p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
