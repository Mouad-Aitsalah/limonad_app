import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DriverHomeView } from "@/components/driver/driver-home-view";
import { AuthServiceError } from "@/lib/server/auth";
import { getCurrentDriverTruck } from "@/lib/server/drivers";
import { requireModulePage } from "@/lib/server/module-guard";

export const metadata: Metadata = {
  title: "Accueil",
};

export default async function DriverHomePage() {
  await requireModulePage("driverApp");
  const truck = await loadDriverTruck();
  return <DriverHomeView truck={truck} />;
}

async function loadDriverTruck() {
  try {
    return await getCurrentDriverTruck();
  } catch (error) {
    if (error instanceof AuthServiceError) {
      redirect(error.status === 401 ? "/login" : "/");
    }
    throw error;
  }
}
