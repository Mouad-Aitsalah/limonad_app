import type { Metadata } from "next";

import { DriverPosView } from "@/components/driver-pos/driver-pos-view";
import { getDriverPosContext } from "@/lib/server/driver-sales";

export const metadata: Metadata = {
  title: "Point de vente",
};

export default async function DriverPosPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const context = await getDriverPosContext();
  const params = await searchParams;
  const initialCustomerId = params.customerId?.trim() || null;

  return (
    <DriverPosView
      key={initialCustomerId ?? "driver-pos-counter"}
      initialContext={context}
      initialCustomerId={initialCustomerId}
    />
  );
}
