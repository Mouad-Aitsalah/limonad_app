import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  DriverStockUnavailable,
  DriverStockView,
} from "@/components/driver-stock/driver-stock-view";
import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { getCurrentDriverTruckStock } from "@/lib/server/driver-stock";

export const metadata: Metadata = {
  title: "Mon stock",
};

export default async function DriverStockPage() {
  const result = await loadDriverStockPageData();

  if (result.kind === "auth-error") {
    redirect(result.status === 401 ? "/login" : "/");
  }

  if (result.kind === "stock-error") {
    return <DriverStockUnavailable message={result.message} />;
  }

  return <DriverStockView stock={result.stock} />;
}

async function loadDriverStockPageData() {
  try {
    return {
      kind: "success" as const,
      stock: await getCurrentDriverTruckStock(),
    };
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return { kind: "auth-error" as const, status: error.status };
    }

    if (error instanceof OperationsServiceError) {
      return { kind: "stock-error" as const, message: error.message };
    }

    throw error;
  }
}
