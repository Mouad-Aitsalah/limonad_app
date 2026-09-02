import type { Metadata } from "next";

import { DepotRequiredNotice } from "@/components/pos/depot-required-notice";
import { PosLayout } from "@/components/pos/pos-layout";
import { getCounterPosContext } from "@/lib/server/counter-sales";
import { OperationsServiceError } from "@/lib/server/depots";

export const metadata: Metadata = {
  title: "Point de Vente",
};

export default async function PosPage() {
  let context;
  try {
    context = await getCounterPosContext();
  } catch (error) {
    if (error instanceof OperationsServiceError) {
      return <DepotRequiredNotice message={error.message} />;
    }
    throw error;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Point de Vente
        </h1>
        <p className="text-sm text-muted-foreground">
          Encaissement rapide et gestion du panier en temps réel.
        </p>
      </div>

      <PosLayout initialContext={context} />
    </div>
  );
}
