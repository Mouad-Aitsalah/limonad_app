"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCustomerCode } from "@/lib/customer-code";
import { formatCurrency } from "@/lib/utils";
import type { CustomerDto } from "@/types/operations-dto";
import type { CustomerDebtDto, CustomerSettlementDto } from "@/types/customer-settlement";

type SettlementDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type SettlementMethod = "CASH" | "CHECK" | "BANK_TRANSFER";

const methodOptions: Array<{ value: SettlementMethod; label: string }> = [
  { value: "CASH", label: "Especes" },
  { value: "CHECK", label: "Cheque" },
  { value: "BANK_TRANSFER", label: "Virement" },
];

function formatSettlementDate(iso: string) {
  return new Intl.DateTimeFormat("fr-MA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(iso));
}

function resetIdempotencyKey() {
  return crypto.randomUUID();
}

/**
 * "REGLEMENT CLIENT" - a customer paying down (part of) their debt outside
 * of any single invoice. Talks to GET/POST /api/customers/[id]/settlements,
 * itself a thin wrapper over recordCustomerSettlement/getCustomerDebt in
 * lib/server/customer-settlements.ts - see that file's doc comment for why
 * the displayed balance is never Customer.currentBalance.
 */
export function SettlementDialog({ open, onOpenChange }: SettlementDialogProps) {
  const [code, setCode] = React.useState("");
  const [lookingUp, setLookingUp] = React.useState(false);
  const [lookupError, setLookupError] = React.useState<string | null>(null);

  const [customer, setCustomer] = React.useState<CustomerDto | null>(null);
  const [debt, setDebt] = React.useState<CustomerDebtDto | null>(null);
  const [settlements, setSettlements] = React.useState<CustomerSettlementDto[]>([]);
  const [loadingDebt, setLoadingDebt] = React.useState(false);

  const [amount, setAmount] = React.useState("");
  const [method, setMethod] = React.useState<SettlementMethod>("CASH");
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const idempotencyKeyRef = React.useRef(resetIdempotencyKey());

  function resetAll() {
    setCode("");
    setLookupError(null);
    setCustomer(null);
    setDebt(null);
    setSettlements([]);
    setAmount("");
    setMethod("CASH");
    setFormError(null);
  }

  async function loadDebtAndHistory(customerId: string) {
    setLoadingDebt(true);
    try {
      const response = await fetch(`/api/customers/${customerId}/settlements`, {
        cache: "no-store",
      });
      const body = (await response.json()) as {
        debt?: CustomerDebtDto;
        settlements?: CustomerSettlementDto[];
        message?: string;
      };
      if (!response.ok || !body.debt) {
        toast.error(body.message ?? "Impossible de charger le solde du client.");
        return;
      }
      setDebt(body.debt);
      setSettlements(body.settlements ?? []);
    } catch {
      toast.error("Impossible de charger le solde du client.");
    } finally {
      setLoadingDebt(false);
    }
  }

  async function lookupCustomer() {
    const trimmed = code.trim();
    if (!trimmed || lookingUp) return;
    setLookingUp(true);
    setLookupError(null);
    try {
      const response = await fetch(`/api/customers/by-number?n=${encodeURIComponent(trimmed)}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as { customer?: CustomerDto; message?: string };
      if (!response.ok || !body.customer) {
        setLookupError(body.message ?? "Client introuvable.");
        setCustomer(null);
        setDebt(null);
        setSettlements([]);
        return;
      }
      setCustomer(body.customer);
      setAmount("");
      setFormError(null);
      idempotencyKeyRef.current = resetIdempotencyKey();
      await loadDebtAndHistory(body.customer.id);
    } catch {
      setLookupError("Recherche impossible.");
    } finally {
      setLookingUp(false);
    }
  }

  const parsedAmount = Number(amount.replace(",", "."));
  const hasValidAmount = amount.trim() !== "" && Number.isFinite(parsedAmount) && parsedAmount > 0;
  const soldeApres = debt && hasValidAmount ? debt.debt - parsedAmount : (debt?.debt ?? null);
  const noDebt = debt !== null && debt.debt <= 0;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!customer || !debt || submitting) return;

    if (!hasValidAmount) {
      setFormError("Le montant du reglement doit etre strictement positif.");
      return;
    }
    if (parsedAmount > debt.debt) {
      setFormError("Le montant du reglement depasse le solde du client.");
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
        settlement?: CustomerSettlementDto;
        message?: string;
        fieldErrors?: Record<string, string>;
      };
      if (!response.ok || !body.settlement) {
        setFormError(body.fieldErrors?.amount ?? body.message ?? "Impossible d'enregistrer le reglement.");
        return;
      }
      toast.success(`Reglement de ${formatCurrency(parsedAmount)} enregistre.`);
      setAmount("");
      idempotencyKeyRef.current = resetIdempotencyKey();
      await loadDebtAndHistory(customer.id);
    } catch {
      setFormError("Impossible d'enregistrer le reglement.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) resetAll();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">Reglement client</DialogTitle>
          <DialogDescription>
            Encaisser tout ou partie de la creance d&apos;un client sur son compte.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="settlement-customer-code">Code client</Label>
            <Input
              id="settlement-customer-code"
              value={code}
              placeholder="ex : 15 ou 3421/15"
              disabled={lookingUp}
              aria-invalid={Boolean(lookupError)}
              onChange={(event) => {
                setCode(event.target.value);
                if (lookupError) setLookupError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void lookupCustomer();
                }
              }}
              onBlur={() => {
                if (code.trim() && !customer) void lookupCustomer();
              }}
            />
            {lookupError ? <p className="text-xs text-destructive">{lookupError}</p> : null}
          </div>

          {customer ? (
            <>
              <div className="grid grid-cols-2 gap-3 rounded-2xl border border-border bg-muted/20 p-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Nom client</p>
                  <p className="font-medium text-foreground">{customer.name}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Code</p>
                  <p className="font-medium text-foreground">{formatCustomerCode(customer.code)}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">Solde client</p>
                  <p className="text-lg font-semibold tabular-nums text-foreground">
                    {loadingDebt || !debt ? "..." : formatCurrency(debt.debt)}
                  </p>
                </div>
              </div>

              {noDebt ? (
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
                  Ce client n&apos;a aucune creance a regler.
                </p>
              ) : (
                <form className="space-y-3" onSubmit={handleSubmit}>
                  <div className="space-y-2">
                    <Label htmlFor="settlement-amount">Montant du reglement</Label>
                    <Input
                      id="settlement-amount"
                      type="number"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      value={amount}
                      disabled={submitting}
                      aria-invalid={Boolean(formError)}
                      onChange={(event) => {
                        setAmount(event.target.value);
                        if (formError) setFormError(null);
                      }}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="settlement-method">Mode de reglement</Label>
                    <Select
                      value={method}
                      onValueChange={(value) => setMethod(value as SettlementMethod)}
                    >
                      <SelectTrigger id="settlement-method" className="w-full">
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

                  <div className="flex items-center justify-between rounded-2xl border border-border bg-muted/10 px-4 py-3">
                    <span className="text-sm font-medium text-muted-foreground">
                      Solde apres reglement
                    </span>
                    <span className="text-lg font-semibold tabular-nums">
                      {soldeApres === null ? "-" : formatCurrency(Math.max(0, soldeApres))}
                    </span>
                  </div>

                  {formError ? <p className="text-xs text-destructive">{formError}</p> : null}

                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                      Annuler
                    </Button>
                    <Button type="submit" disabled={submitting || loadingDebt}>
                      {submitting ? "Enregistrement..." : "Valider reglement"}
                    </Button>
                  </DialogFooter>
                </form>
              )}

              {settlements.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Reglements recents</p>
                  <div className="max-h-32 overflow-y-auto rounded-xl border border-border">
                    <table className="w-full text-xs">
                      <tbody>
                        {settlements.slice(0, 5).map((settlement) => (
                          <tr key={settlement.id} className="border-b border-border last:border-0">
                            <td className="px-2 py-1.5 text-muted-foreground">
                              {formatSettlementDate(settlement.date)}
                            </td>
                            <td className="px-2 py-1.5 font-medium text-foreground">
                              {settlement.settlementNumber}
                            </td>
                            <td className="px-2 py-1.5 text-muted-foreground">
                              {methodOptions.find((option) => option.value === settlement.method)
                                ?.label ?? settlement.method}
                            </td>
                            <td className="px-2 py-1.5 text-right font-semibold tabular-nums">
                              {formatCurrency(settlement.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Annuler
              </Button>
            </DialogFooter>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
