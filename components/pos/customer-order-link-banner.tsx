"use client";

import { Globe, X } from "lucide-react";

import { Button } from "@/components/ui/button";

type CustomerOrderLinkBannerProps = {
  orderNumber: string;
  /** The operator changed the customer: the sale would be refused (the order's customer is required). */
  customerMismatch: boolean;
  onDetach: () => void;
};

/**
 * Shown while the POS cart is linked to an online customer order: the normal
 * validation will invoice it (and mark it "Facturée"). "Détacher" unlinks the
 * cart - the order then stays "Acceptée".
 */
export function CustomerOrderLinkBanner({ orderNumber, customerMismatch, onDetach }: CustomerOrderLinkBannerProps) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3.5 py-2 text-sm text-sky-900"
    >
      <span className="flex items-center gap-2">
        <Globe aria-hidden="true" className="h-4 w-4 shrink-0" />
        Panier lié à la commande en ligne <strong>{orderNumber}</strong> : la validation la marquera « Facturée ».
        {customerMismatch ? (
          <span className="font-medium text-red-700">Le client doit rester celui de la commande.</span>
        ) : null}
      </span>
      <Button type="button" variant="ghost" size="sm" onClick={onDetach} className="text-sky-900 hover:bg-sky-100">
        <X aria-hidden="true" className="h-3.5 w-3.5" />
        Détacher
      </Button>
    </div>
  );
}
