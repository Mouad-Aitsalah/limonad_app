import {
  ArrowLeftRight,
  Banknote,
  CreditCard,
  HandCoins,
  Receipt,
  type LucideIcon,
} from "lucide-react";

export type PaymentMethodValue =
  | "especes"
  | "cheque"
  | "carte"
  | "virement"
  | "credit";

export type PaymentMethodOption = {
  value: PaymentMethodValue;
  label: string;
  icon: LucideIcon;
};

export const defaultPaymentMethod: PaymentMethodValue = "especes";

export const paymentMethods: PaymentMethodOption[] = [
  { value: "especes", label: "Espèces", icon: Banknote },
  { value: "cheque", label: "Chèque", icon: Receipt },
  { value: "carte", label: "Carte bancaire", icon: CreditCard },
  { value: "virement", label: "Virement", icon: ArrowLeftRight },
  { value: "credit", label: "Crédit Client", icon: HandCoins },
];
