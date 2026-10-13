import { InvoiceHeader } from "@/components/pos/invoice-header";
import { OfflineStatusBar } from "@/components/pos/offline-status-bar";
import type { NetworkState, SalesSyncStatus } from "@/lib/offline/counter-pos";

/**
 * The POS header block, one horizontal row with vertical separators:
 * network status (icon + "En ligne" / "Hors connexion", sync counters and
 * button when there are some) | N° Facture | Heure. Light background, rounded
 * border (the former invoice strip's look). It wraps instead of overflowing
 * on narrow screens. Pure display: every value and handler comes from the POS
 * (useCounterPosOffline, activeInvoiceLabel) unchanged.
 */
export function PosHeaderInfo({
  networkState,
  pendingCount,
  failedCount,
  syncStatus,
  onSyncNow,
  invoiceLabel,
}: {
  networkState: NetworkState;
  pendingCount: number;
  failedCount: number;
  syncStatus: SalesSyncStatus;
  onSyncNow: () => void;
  invoiceLabel?: string;
}) {
  return (
    <div
      data-testid="pos-header-info"
      className="flex flex-wrap items-center gap-y-1.5 divide-x divide-border rounded-2xl border border-border bg-muted/40 py-2"
    >
      <div className="px-2">
        <OfflineStatusBar
          variant="inline"
          networkState={networkState}
          pendingCount={pendingCount}
          failedCount={failedCount}
          syncStatus={syncStatus}
          onSyncNow={onSyncNow}
        />
      </div>
      <InvoiceHeader invoiceLabel={invoiceLabel} />
    </div>
  );
}
