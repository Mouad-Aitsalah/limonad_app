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

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 rounded-2xl border border-border bg-muted/40 p-4 text-sm sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground">Caissier</p>
          <p className="font-medium text-foreground">{context.userName}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Date</p>
          <p className="font-medium text-foreground" suppressHydrationWarning>
            {now.toLocaleDateString("fr-FR")}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Heure</p>
          <p className="font-medium text-foreground" suppressHydrationWarning>
            {now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">POS / Caisse</p>
          <p className="font-medium text-foreground">{context.depotName}</p>
        </div>
      </div>

      {validated ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {lastDeposit.number} valide et enregistre. Le detail des coupures n&apos;est plus
          modifiable depuis cet ecran - utilisez &laquo;&nbsp;Nouveau versement&nbsp;&raquo; pour en
          declarer un autre.
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
        <div className="space-y-5">
      <div className="space-y-3">
        <p className="text-sm font-medium text-foreground">Coupures comptees en caisse</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cashDenominations.map((value) => {
            const quantity = Number(quantities[value] || 0);
            const lineAmount = Number.isFinite(quantity) ? value * quantity : 0;

            return (
              <Card key={value} className="ring-0 shadow-[0_6px_18px_rgba(15,23,42,0.05)]">
                <CardContent className="space-y-2.5">
                  <p className="text-sm font-semibold text-foreground tabular-nums">
                    {formatCurrency(value)}
                  </p>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Quantite</Label>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      disabled={validated}
                      value={quantities[value] ?? "0"}
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) =>
                        setQuantities((current) => ({ ...current, [value]: event.target.value }))
                      }
                    />
                  </div>
                  <p className="text-right text-sm font-medium text-foreground tabular-nums">
                    {formatCurrency(lineAmount)}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Montant especes a verser</Label>
          <Input
            type="number"
            min={0}
            step={0.01}
            disabled={validated}
            value={cashDepositInput}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setCashDepositInput(event.target.value)}
            placeholder="0.00"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Montant cheques</Label>
          <Input
            type="number"
            min={0}
            step={0.01}
            disabled={validated}
            value={checkTotalInput}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setCheckTotalInput(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Commentaire (facultatif)</Label>
          <Textarea
            disabled={validated}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Remarque sur ce versement..."
            className="min-h-10"
          />
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-muted/50 p-4">
        <div className="grid gap-2 text-sm sm:grid-cols-3">
          <div className="flex justify-between sm:block">
            <span className="text-muted-foreground">Especes a verser</span>
            <span className="font-medium text-foreground tabular-nums sm:ml-2">
              {formatCurrency(Number.isFinite(cashDepositAmount) ? cashDepositAmount : 0)}
            </span>
          </div>
          <div className="flex justify-between sm:block">
            <span className="text-muted-foreground">Cheques</span>
            <span className="font-medium text-foreground tabular-nums sm:ml-2">
              {formatCurrency(Number.isFinite(checkTotal) ? checkTotal : 0)}
            </span>
          </div>
          <div className="flex justify-between border-t border-border pt-2 text-base font-semibold sm:col-span-1 sm:border-0 sm:pt-0 sm:text-lg">
            <span>Total versement</span>
            <span className="tabular-nums">{formatCurrency(total)}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {!validated ? (
          <Button type="button" size="lg" disabled={saving} onClick={handleValidate}>
            <Wallet className="h-4 w-4" />
            {saving ? "Validation..." : "Valider le versement"}
          </Button>
        ) : (
          <>
            <Button type="button" size="lg" onClick={handlePrint}>
              <Printer className="h-4 w-4" />
              Imprimer
            </Button>
            <Button type="button" variant="outline" size="lg" onClick={resetForm}>
              <RotateCcw className="h-4 w-4" />
              Nouveau versement
            </Button>
          </>
        )}
        {!validated ? (
          <Button type="button" variant="outline" size="lg" disabled={saving} onClick={resetForm}>
            Annuler
          </Button>
        ) : null}
      </div>

        </div>

        <Card className="border-emerald-200/80 bg-emerald-50/40 shadow-[0_10px_30px_rgba(5,150,105,0.08)] xl:sticky xl:top-6">
          <CardContent className="space-y-5 p-5">
            <div>
              <p className="text-xs font-semibold tracking-[0.14em] text-emerald-700">SITUATION DE LA CAISSE</p>
              <p className="mt-1 text-sm text-muted-foreground">{context.depotName} - {context.userName}</p>
            </div>
            <SummaryLine label="Ventes especes du jour" value={context.cashSummary.cashSales} />
            <SummaryLine label="Charges especes du jour" value={-context.cashSummary.cashExpenses} negative />
            <div className="border-t border-emerald-200 pt-4">
              <SummaryLine label="Disponible caisse" value={context.cashSummary.availableCash} strong />
            </div>
            {context.cashSummary.hasCashShortfall ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
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
    <div className="flex items-end justify-between gap-4">
      <span className={strong ? "font-semibold text-foreground" : "text-sm text-muted-foreground"}>{label}</span>
      <span className={strong ? "text-lg font-semibold tabular-nums text-foreground" : "font-medium tabular-nums text-foreground"}>
        {negative ? "- " : ""}{formatCurrency(Math.abs(value))}
      </span>
    </div>
  );
}
