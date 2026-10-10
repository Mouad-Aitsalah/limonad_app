"use client";

import * as React from "react";
import { toast } from "sonner";

import type { CustomerOrderDetailDto } from "@/types/customer-order-dto";

/** Accept / reject calls of the "Commandes en ligne" screen (status changes only). */
export function useCustomerOrderActions(onChanged: (order: CustomerOrderDetailDto) => void) {
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const run = React.useCallback(
    async (orderId: string, action: "accept" | "reject", reason?: string) => {
      setBusyId(orderId);
      try {
        const response = await fetch(`/api/customer-orders/${encodeURIComponent(orderId)}/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action === "reject" ? { reason: reason?.trim() || undefined } : {}),
        });
        const payload = (await response.json().catch(() => ({}))) as { order?: CustomerOrderDetailDto; message?: string };
        if (!response.ok || !payload.order) throw new Error(payload.message ?? "Action impossible.");
        onChanged(payload.order);
        toast.success(
          action === "accept"
            ? `Commande ${payload.order.orderNumber} acceptée.`
            : `Commande ${payload.order.orderNumber} refusée.`,
        );
        return payload.order;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Action impossible.");
        return null;
      } finally {
        setBusyId(null);
      }
    },
    [onChanged],
  );

  return {
    busyId,
    accept: (orderId: string) => run(orderId, "accept"),
    reject: (orderId: string, reason?: string) => run(orderId, "reject", reason),
  };
}
