import type { Metadata } from "next";

import { PosLayout } from "@/components/pos/pos-layout";
import { getCounterPosContext } from "@/lib/server/counter-sales";

export const metadata: Metadata = {
  title: "Point de Vente",
};

export default async function PosPage() {
  const context = await getCounterPosContext();

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
