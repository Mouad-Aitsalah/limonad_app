import { CreditCard } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";
import { posPaymentMethods, type PosPaymentMethodValue } from "@/types/pos";

export type MixedPaymentAmounts = { cash: number; cheque: number };

/** Same rounding-to-2-decimals comparison as the server's
 * resolveMixedPaymentSplit (lib/server/sales-shared.ts) - this is a UI hint
 * only, the real enforcement always happens server-side. A mixed payment
 * may now cover only PART of the total (the rest becomes a customer
 * receivable), so `sum < target` is no longer an error - only overpayment
 * and a completely empty split are refused. */
export function describeMixedPaymentError(
  amounts: MixedPaymentAmounts,
  total: number,
): string | null {
  const sum = Math.round((amounts.cash + amounts.cheque) * 100) / 100;
  const target = Math.round(total * 100) / 100;
  if (sum <= 0) return "Saisissez un montant en espèces ou en chèque.";
  if (sum > target) return "Le montant saisi dépasse le total à régler.";
  return null;
}

type PaymentSelectorProps = {
  paymentMethod: PosPaymentMethodValue;
  onPaymentMethodChange: (value: PosPaymentMethodValue) => void;
  chequeNumber: string;
  onChequeNumberChange: (value: string) => void;
  banque: string;
  onBanqueChange: (value: string) => void;
  dateEcheance: string;
  onDateEcheanceChange: (value: string) => void;
  mixedAmounts: MixedPaymentAmounts;
  onMixedAmountsChange: (value: MixedPaymentAmounts) => void;
  mixedTotal: number;
};

export function PaymentSelector({
  paymentMethod,
  onPaymentMethodChange,
  chequeNumber,
  onChequeNumberChange,
  banque,
  onBanqueChange,
  dateEcheance,
  onDateEcheanceChange,
  mixedAmounts,
  onMixedAmountsChange,
  mixedTotal,
}: PaymentSelectorProps) {
  const selected = posPaymentMethods.find((method) => method.value === paymentMethod);
  const mixedError =
    paymentMethod === "MIXED" ? describeMixedPaymentError(mixedAmounts, mixedTotal) : null;

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <CreditCard aria-hidden="true" className="h-3.5 w-3.5" />
          Mode de règlement
        </Label>
        <Select
          value={paymentMethod}
          onValueChange={(value) => value && onPaymentMethodChange(value as PosPaymentMethodValue)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Sélectionner">
              {() => selected?.label ?? "Sélectionner"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {posPaymentMethods.map((method) => (
              <SelectItem key={method.value} value={method.value}>
                {method.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {paymentMethod === "CHECK" && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="chequeNumber">Numéro de chèque</Label>
            <Input
              id="chequeNumber"
              value={chequeNumber}
              onChange={(event) => onChequeNumberChange(event.target.value)}
              placeholder="0012345"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="banque">Banque</Label>
            <Input
              id="banque"
              value={banque}
              onChange={(event) => onBanqueChange(event.target.value)}
              placeholder="Attijariwafa Bank"
            />
          </div>
        </div>
      )}

      {paymentMethod === "MIXED" && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="mixedCash">Espèces</Label>
              <Input
                id="mixedCash"
                type="number"
                min={0}
                step="0.01"
                value={mixedAmounts.cash}
                onChange={(event) =>
                  onMixedAmountsChange({ ...mixedAmounts, cash: Number(event.target.value) })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mixedCheque">Chèque</Label>
              <Input
                id="mixedCheque"
                type="number"
                min={0}
                step="0.01"
                value={mixedAmounts.cheque}
                onChange={(event) =>
                  onMixedAmountsChange({ ...mixedAmounts, cheque: Number(event.target.value) })
                }
              />
            </div>
          </div>

          {(() => {
            const paid = Math.round((mixedAmounts.cash + mixedAmounts.cheque) * 100) / 100;
            const remaining = Math.max(0, Math.round((mixedTotal - paid) * 100) / 100);
            return (
              <div className="space-y-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs tabular-nums">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Espèces</span>
                  <span>{formatCurrency(mixedAmounts.cash)}</span>
                </div>
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Chèque</span>
                  <span>{formatCurrency(mixedAmounts.cheque)}</span>
                </div>
                <div className="flex items-center justify-between border-t border-border pt-1 font-medium text-foreground">
                  <span>Montant payé</span>
                  <span>{formatCurrency(paid)}</span>
                </div>
                <div
                  className={
                    "flex items-center justify-between font-semibold " +
                    (remaining > 0 ? "text-amber-700" : "text-emerald-700")
                  }
                >
                  <span>Reste à crédit</span>
                  <span>{formatCurrency(remaining)}</span>
                </div>
              </div>
            );
          })()}

          {mixedError ? (
            <p className="text-xs font-medium text-red-600">{mixedError}</p>
          ) : null}
        </div>
      )}

      {paymentMethod === "BANK_TRANSFER" && (
        <div className="space-y-2">
          <Label htmlFor="banque">Référence virement</Label>
          <Input
            id="banque"
            value={banque}
            onChange={(event) => onBanqueChange(event.target.value)}
            placeholder="Référence bancaire"
          />
        </div>
      )}

      {paymentMethod === "CREDIT" && (
        <div className="space-y-2">
          <Label htmlFor="dateEcheance">Date d&apos;échéance</Label>
          <Input
            id="dateEcheance"
            type="date"
            value={dateEcheance}
            onChange={(event) => onDateEcheanceChange(event.target.value)}
          />
        </div>
      )}
    </div>
  );
}
