"use client";

import * as React from "react";
import Link from "next/link";
import { ShoppingCart } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CustomerOrderStatusBadge } from "@/components/customer-orders/customer-order-status-badge";
import { canOpenInPos, canStaffTransition } from "@/lib/client-portal-rules";
import { cn, formatCurrency } from "@/lib/utils";
import type { CustomerOrderDetailDto } from "@/types/customer-order-dto";

type CustomerOrderDetailDialogProps = {
  order: CustomerOrderDetailDto | null;
  loading: boolean;
  busy: boolean;
  onClose: () => void;
  onAccept: (orderId: string) => void;
  onReject: (orderId: string, reason: string) => void;
};

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("fr-MA", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

/** One online order: lines (estimated at submission), contact, note, and the staff actions. */
export function CustomerOrderDetailDialog({ order, loading, busy, onClose, onAccept, onReject }: CustomerOrderDetailDialogProps) {
  const [rejecting, setRejecting] = React.useState(false);
  const [reason, setReason] = React.useState("");
  // The reason form only makes sense while this order can still be refused
  // (it disappears once the refusal went through, or for another order).
  const showRejectForm = rejecting && order !== null && canStaffTransition(order.status, "REJECTED");

  return (
    <Dialog
      open={order !== null || loading}
      onOpenChange={(open) => {
        if (!open && !busy) {
          setRejecting(false);
          setReason("");
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        {!order ? (
          <DialogHeader>
            <DialogTitle>Chargement de la commande…</DialogTitle>
          </DialogHeader>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                Commande {order.orderNumber} <CustomerOrderStatusBadge status={order.status} invoicePending={order.invoicePending} />
              </DialogTitle>
              <DialogDescription>
                {order.customer.name} ({order.customer.displayCode}) · envoyée le {formatDateTime(order.createdAt)}
                {order.contactPhone ? ` · tél. ${order.contactPhone} (non vérifié)` : ""}
              </DialogDescription>
            </DialogHeader>

            <div className="max-h-72 overflow-y-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Produit</th>
                    <th className="px-3 py-2 text-right font-medium">Qté</th>
                    <th className="px-3 py-2 text-right font-medium">Total estimé</th>
                  </tr>
                </thead>
                <tbody>
                  {order.lines.map((line) => (
                    <tr key={line.productId} className="border-t border-border">
                      <td className="px-3 py-2">
                        {line.productName}
                        <span className="block text-xs text-muted-foreground">Réf. {line.productReference}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{line.quantity}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(line.totalTTC)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between text-sm font-semibold">
              <span>Total estimé TTC (au moment de l&apos;envoi)</span>
              <span className="tabular-nums">{formatCurrency(order.totalTTC)}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Les prix définitifs sont recalculés par le POS au moment de la facturation.
            </p>

            {order.note ? (
              <p className="rounded-xl bg-muted/50 px-3 py-2 text-sm">
                <span className="font-medium">Note du client :</span> {order.note}
              </p>
            ) : null}
            {order.rejectionReason ? (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
                <span className="font-medium">Motif du refus :</span> {order.rejectionReason}
              </p>
            ) : null}

            {showRejectForm ? (
              <div className="space-y-1.5">
                <Label htmlFor="customer-order-reject-reason">Motif du refus (facultatif)</Label>
                <Textarea
                  id="customer-order-reject-reason"
                  rows={2}
                  maxLength={500}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </div>
            ) : null}

            <DialogFooter className="flex-wrap gap-2">
              {showRejectForm ? (
                <>
                  <Button type="button" variant="outline" onClick={() => setRejecting(false)} disabled={busy}>
                    Retour
                  </Button>
                  <Button type="button" variant="destructive" onClick={() => onReject(order.id, reason)} disabled={busy}>
                    Confirmer le refus
                  </Button>
                </>
              ) : (
                <>
                  {canStaffTransition(order.status, "REJECTED") ? (
                    <Button type="button" variant="outline" onClick={() => setRejecting(true)} disabled={busy}>
                      Refuser
                    </Button>
                  ) : null}
                  {canStaffTransition(order.status, "ACCEPTED") ? (
                    <Button type="button" onClick={() => onAccept(order.id)} disabled={busy}>
                      Accepter
                    </Button>
                  ) : null}
                  {canOpenInPos(order.status) ? (
                    <Link
                      href={`/pos?customerOrder=${encodeURIComponent(order.id)}`}
                      className={cn(buttonVariants(), "bg-emerald-600 text-white hover:bg-emerald-700")}
                    >
                      <ShoppingCart aria-hidden="true" className="h-4 w-4" />
                      Ouvrir dans le POS
                    </Link>
                  ) : null}
                </>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
