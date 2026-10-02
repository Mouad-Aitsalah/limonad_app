"use client";

import * as React from "react";
import { Printer, RotateCcw, Wallet } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/utils";
import { cashDenominations } from "@/types/cash-deposits";
import type { CashDepositContextDto, CashDepositDto } from "@/types/cash-deposits";
import { DepositReceiptPrint } from "@/components/cash-deposits/deposit-receipt-print";

type NewDepositFormProps = {
  context: CashDepositContextDto;
  onDepositCreated: (deposit: CashDepositDto, context: CashDepositContextDto) => void;
};

function emptyQuantities(): Record<number, string> {
  return Object.fromEntries(cashDenominations.map((value) => [value, "0"]));
}

export function NewDepositForm({ context, onDepositCreated }: NewDepositFormProps) {
  const [quantities, setQuantities] = React.useState<Record<number, string>>(emptyQuantities);
  const [cashDepositInput, setCashDepositInput] = React.useState("");
  const [checkTotalInput, setCheckTotalInput] = React.useState("0");
  const [notes, setNotes] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [lastDeposit, setLastDeposit] = React.useState<CashDepositDto | null>(null);
  // Synchronous guard against a double-click racing two POSTs before React's
  // disabled state re-renders - the same pattern used by the Inventaire and
  // écritures dialogs elsewhere in COMDIS.
  const savingRef = React.useRef(false);

  const countedCash = React.useMemo(
    () =>
      cashDenominations.reduce((sum, value) => {
        const quantity = Number(quantities[value] || 0);
        return sum + (Number.isFinite(quantity) ? value * quantity : 0);
      }, 0),
    [quantities],
  );
  const cashDepositAmount = Number(cashDepositInput || 0);
  const checkTotal = Number(checkTotalInput || 0);
  const total =
    (Number.isFinite(cashDepositAmount) ? cashDepositAmount : 0) +
    (Number.isFinite(checkTotal) ? checkTotal : 0);
  const cashDifference = countedCash - context.cashSummary.availableCash;
  const cashRemaining = countedCash - (Number.isFinite(cashDepositAmount) ? cashDepositAmount : 0);

  function resetForm() {
    setQuantities(emptyQuantities());
    setCashDepositInput("");
    setCheckTotalInput("0");
    setNotes("");
    setLastDeposit(null);
  }

  async function handleValidate() {
    if (savingRef.current) return;

    const lines = cashDenominations.map((value) => ({
      denomination: value,
      quantity: Number(quantities[value] || 0),
    }));

    if (lines.some((line) => !Number.isInteger(line.quantity) || line.quantity < 0)) {
      toast.error("Les quantites doivent etre des nombres entiers positifs ou nuls.");
      return;
    }
    if (!Number.isFinite(cashDepositAmount) || cashDepositAmount < 0) {
      toast.error("Le montant en especes a verser doit etre positif ou nul.");
      return;
    }
    if (cashDepositAmount > countedCash) {
      toast.error("Le versement en especes ne peut pas depasser les especes comptees.");
      return;
    }
    if (!Number.isFinite(checkTotal) || checkTotal < 0) {
      toast.error("Le montant des cheques doit etre positif ou nul.");
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      const response = await fetch("/api/cash-deposits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          denominations: lines,
          cashDepositAmount,
          checkTotal,
          notes: notes.trim() || null,
        }),
      });
      const body = (await response.json()) as {
        deposit?: CashDepositDto;
        context?: CashDepositContextDto;
        message?: string;
      };
      if (!response.ok || !body.deposit || !body.context) {
        toast.error(body.message ?? "Impossible d'enregistrer le versement.");
        return;
      }

      setLastDeposit(body.deposit);
      toast.success(`${body.deposit.number} enregistre.`);
      onDepositCreated(body.deposit, body.context);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function handlePrint() {
    if (!lastDeposit) {
      toast.error("Validez d'abord le versement.");
      return;
    }
    window.setTimeout(() => window.print(), 0);
  }

  const now = new Date();
  const validated = lastDeposit !== null;

  // Type of this screen is scaled x1.4 on purpose (14px -> 19.6px, 12px ->
  // 16.8px, 16px -> 22.4px): the values below are the explicit pixel sizes.
  const inputClassName = "h-14 rounded-2xl px-4 text-right text-[19.6px] max-lg:text-[19.6px]! tabular-nums";
  const fieldRowClassName = "flex items-center justify-between gap-3 px-4 py-3";
  // Banknote / coin rows only: x0.8 of the former 80px row (py-3 + h-14 input
  // -> py-2 + h-12 input = 64px). The other rows keep fieldRowClassName.
  const denominationRowClassName = "flex items-center justify-between gap-3 px-4 py-2";
  const denominationInputClassName = inputClassName.replace("h-14", "h-12");

  return (
    <div className="space-y-5 text-[19.6px]">
      <div className="grid grid-cols-2 gap-4 rounded-2xl border border-border bg-muted/40 p-5 sm:grid-cols-4">
        <div>
          <p className="text-[16.8px] text-muted-foreground">Caissier</p>
          <p className="font-medium text-foreground">{context.userName}</p>
        </div>
        <div>
          <p className="text-[16.8px] text-muted-foreground">Date</p>
          <p className="font-medium text-foreground" suppressHydrationWarning>
            {now.toLocaleDateString("fr-FR")}
          </p>
        </div>
        <div>
          <p className="text-[16.8px] text-muted-foreground">Heure</p>
          <p className="font-medium text-foreground" suppressHydrationWarning>
            {now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
        <div>
          <p className="text-[16.8px] text-muted-foreground">POS / Caisse</p>
          <p className="font-medium text-foreground">{context.depotName}</p>
        </div>
      </div>

      {validated ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-emerald-800">
          {lastDeposit.number} valide et enregistre. Le detail des coupures n&apos;est plus
          modifiable depuis cet ecran - utilisez &laquo;&nbsp;Nouveau versement&nbsp;&raquo; pour en
          declarer un autre.
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_28rem] xl:items-start">
        <div className="space-y-5">
          {/* One single column: label on the left, field on the right. */}
          <div className="space-y-3">
            <p className="text-[22.4px] font-semibold text-foreground">Coupures comptees en caisse</p>
            <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
              {cashDenominations.map((value) => {
                const quantity = Number(quantities[value] || 0);
                const lineAmount = Number.isFinite(quantity) ? value * quantity : 0;

                return (
                  <div key={value} className={denominationRowClassName}>
                    <div className="min-w-0">
                      <Label htmlFor={`deposit-qty-${value}`} className="text-[19.6px] leading-tight font-semibold tabular-nums">
                        {formatCurrency(value)}
                      </Label>
                      <p className="mt-0.5 text-[16.8px] leading-tight text-muted-foreground tabular-nums">
                        {formatCurrency(lineAmount)}
                      </p>
                    </div>
                    <Input
                      id={`deposit-qty-${value}`}
                      type="number"
                      min={0}
                      step={1}
                      disabled={validated}
                      value={quantities[value] ?? "0"}
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) =>
                        setQuantities((current) => ({ ...current, [value]: event.target.value }))
                      }
                      aria-label={`Quantite de ${formatCurrency(value)}`}
                      className={`${denominationInputClassName} w-36 shrink-0 sm:w-52`}
                    />
                  </div>
                );
              })}

              <div className={fieldRowClassName}>
                <Label htmlFor="deposit-cash-amount" className="text-[19.6px] font-semibold">
                  Montant especes a verser
                </Label>
                <Input
                  id="deposit-cash-amount"
                  type="number"
                  min={0}
                  step={0.01}
                  disabled={validated}
                  value={cashDepositInput}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => setCashDepositInput(event.target.value)}
                  placeholder="0.00"
                  className={`${inputClassName} w-36 shrink-0 sm:w-52`}
                />
              </div>

              <div className={fieldRowClassName}>
                <Label htmlFor="deposit-check-total" className="text-[19.6px] font-semibold">
                  Cheque
                </Label>
                <Input
                  id="deposit-check-total"
                  type="number"
                  min={0}
                  step={0.01}
                  disabled={validated}
                  value={checkTotalInput}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => setCheckTotalInput(event.target.value)}
                  className={`${inputClassName} w-36 shrink-0 sm:w-52`}
                />
              </div>

              <div className={fieldRowClassName}>
                <Label htmlFor="deposit-notes" className="text-[19.6px] font-semibold">
                  Commentaire (facultatif)
                </Label>
                <Textarea
                  id="deposit-notes"
                  disabled={validated}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Remarque sur ce versement..."
                  className="min-h-14 w-36 shrink-0 rounded-2xl px-4 py-3 text-[19.6px] max-lg:text-[19.6px]! sm:w-52"
                />
              </div>

              <div className="space-y-2 bg-muted/50 px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Especes a verser</span>
                  <span className="font-medium text-foreground tabular-nums">
                    {formatCurrency(Number.isFinite(cashDepositAmount) ? cashDepositAmount : 0)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Cheques</span>
                  <span className="font-medium text-foreground tabular-nums">
                    {formatCurrency(Number.isFinite(checkTotal) ? checkTotal : 0)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-border pt-2 text-[25.2px] font-semibold">
                  <span>Total</span>
                  <span className="tabular-nums">{formatCurrency(total)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            {!validated ? (
              <Button
                type="button"
                size="lg"
                disabled={saving}
                onClick={handleValidate}
                className="h-14 gap-3 px-6 text-[21.3px]"
              >
                <Wallet className="h-5 w-5" />
                {saving ? "Validation..." : "Valider le versement"}
              </Button>
            ) : (
              <>
                <Button type="button" size="lg" onClick={handlePrint} className="h-14 gap-3 px-6 text-[21.3px]">
                  <Printer className="h-5 w-5" />
                  Imprimer
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  onClick={resetForm}
                  className="h-14 gap-3 px-6 text-[21.3px]"
                >
                  <RotateCcw className="h-5 w-5" />
                  Nouveau versement
                </Button>
              </>
            )}
            {!validated ? (
              <Button
                type="button"
                variant="outline"
                size="lg"
                disabled={saving}
                onClick={resetForm}
                className="h-14 px-6 text-[21.3px]"
              >
                Annuler
              </Button>
            ) : null}
          </div>
        </div>

        <Card className="border-emerald-200/80 bg-emerald-50/40 shadow-[0_10px_30px_rgba(5,150,105,0.08)] xl:sticky xl:top-6">
          <CardContent className="space-y-5 p-5">
            <div>
              <p className="text-[16.8px] font-semibold tracking-[0.14em] text-emerald-700">SITUATION DE LA CAISSE</p>
              <p className="mt-1 text-[19.6px] text-muted-foreground">{context.depotName} - {context.userName}</p>
            </div>
            <SummaryLine label="Ventes especes du jour" value={context.cashSummary.cashSales} />
            <SummaryLine label="Charges especes du jour" value={-context.cashSummary.cashExpenses} negative />
            <div className="border-t border-emerald-200 pt-4">
              <SummaryLine label="Disponible caisse" value={context.cashSummary.availableCash} strong />
            </div>
            {context.cashSummary.hasCashShortfall ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[16.8px] leading-6 text-amber-900">
                Les sorties especes depassent les encaissements especes de la journee.
              </p>
            ) : null}
            <div className="space-y-3 border-t border-emerald-200 pt-4">
              <SummaryLine label="Especes comptees" value={countedCash} />
              <SummaryLine label="Ecart" value={cashDifference} />
            </div>
            <div className="border-t border-emerald-200 pt-4">
              <SummaryLine label="Reste apres versement" value={cashRemaining} strong />
            </div>
          </CardContent>
        </Card>
      </div>

      <DepositReceiptPrint deposit={lastDeposit} />
    </div>
  );
}

function SummaryLine({
  label,
  value,
  strong = false,
  negative = false,
}: {
  label: string;
  value: number;
  strong?: boolean;
  negative?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
      <span className={strong ? "text-[19.6px] font-semibold text-foreground" : "text-[19.6px] text-muted-foreground"}>{label}</span>
      <span className={strong ? "text-[25.2px] font-semibold tabular-nums text-foreground" : "text-[19.6px] font-medium tabular-nums text-foreground"}>
        {negative ? "- " : ""}{formatCurrency(Math.abs(value))}
      </span>
    </div>
  );
}
