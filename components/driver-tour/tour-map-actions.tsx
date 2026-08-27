"use client";

import { Users } from "lucide-react";

import { Button } from "@/components/ui/button";

export function TourMapActions({
  completedCount,
  totalCount,
  salesCount,
  totalSalesTTC,
  canStart,
  startButtonLabel,
  startButtonDisabled,
  canReturn,
  returnButtonLabel,
  returnButtonDisabled,
  onOpenCustomers,
  onStartTour,
  onReturnTour,
  formatAmount,
}: {
  completedCount: number;
  totalCount: number;
  salesCount: number;
  totalSalesTTC: number;
  canStart: boolean;
  startButtonLabel?: string;
  startButtonDisabled?: boolean;
  canReturn: boolean;
  returnButtonLabel?: string;
  returnButtonDisabled?: boolean;
  onOpenCustomers: () => void;
  onStartTour: () => void;
  onReturnTour: () => void;
  formatAmount: (value: number) => string;
}) {
  return (
    <div className="flex w-full flex-col gap-2 rounded-[20px] border border-border/70 bg-background/94 p-2.5 shadow-[0_16px_40px_rgba(15,23,42,0.16)] backdrop-blur sm:w-auto sm:flex-row sm:items-center">
      <div className="min-w-0 px-1 sm:min-w-[190px]">
        <p className="text-xs font-semibold text-foreground">
          Clients {completedCount}/{totalCount || 0}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {salesCount} vente{salesCount > 1 ? "s" : ""} - {formatAmount(totalSalesTTC)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:flex">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-10 rounded-xl bg-background/80"
          onClick={onOpenCustomers}
        >
          <Users className="h-4 w-4" />
          Clients
        </Button>

        {canStart ? (
          <Button
            type="button"
            size="sm"
            className="h-10 rounded-xl"
            onClick={onStartTour}
            disabled={startButtonDisabled}
          >
            {startButtonLabel ?? "Commencer"}
          </Button>
        ) : null}

        {canReturn ? (
          <Button
            type="button"
            size="sm"
            variant="destructive"
            className="h-10 rounded-xl"
            onClick={onReturnTour}
            disabled={returnButtonDisabled}
          >
            {returnButtonLabel ?? "Terminer"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
