import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LoadingDetailView } from "@/components/loadings/loading-detail-view";
import { OperationsServiceError } from "@/lib/server/depots";
import { getProducts } from "@/lib/server/products";
import { getLoadingById } from "@/lib/server/truck-loadings";

export const metadata: Metadata = {
  title: "Detail chargement",
};

type PageProps = { params: Promise<{ id: string }> };

export default async function ChargementDetailPage({ params }: PageProps) {
  const { id } = await params;

  const [loading, products] = await Promise.all([
    getLoadingById(id).catch((error) => {
      if (error instanceof OperationsServiceError && error.status === 404) {
        return null;
      }
      throw error;
    }),
    getProducts(),
  ]);

  if (!loading) notFound();

  return (
    <LoadingDetailView
      loading={loading}
      products={products.filter((product) => product.status === "ACTIVE")}
    />
  );
}
