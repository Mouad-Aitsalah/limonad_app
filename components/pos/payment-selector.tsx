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
import { posPaymentMethods, type PosPaymentMethodValue } from "@/types/pos";

type PaymentSelectorProps = {
  paymentMethod: PosPaymentMethodValue;
  onPaymentMethodChange: (value: PosPaymentMethodValue) => void;
  chequeNumber: string;
  onChequeNumberChange: (value: string) => void;
  banque: string;
  onBanqueChange: (value: string) => void;
  dateEcheance: string;
  onDateEcheanceChange: (value: string) => void;
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
}: PaymentSelectorProps) {
  const selected = posPaymentMethods.find((method) => method.value === paymentMethod);

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
