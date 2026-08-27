import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DriverTourView } from "@/components/driver-tour/driver-tour-view";
import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { getCurrentDriverTour } from "@/lib/server/driver-tour";

export const metadata: Metadata = {
  title: "Ma tournee",
};

export default async function DriverRoutePage() {
  const currentTour = await loadDriverTourPageData();
  return <DriverTourView currentTour={currentTour} />;
}

async function loadDriverTourPageData() {
  try {
    return await getCurrentDriverTour();
  } catch (error) {
    if (error instanceof AuthServiceError) {
      redirect(error.status === 401 ? "/login" : "/");
    }
    if (error instanceof OperationsServiceError) {
      return {
        tour: null,
        message: error.message,
        startContext: null,
        canStart: false,
        canReturn: false,
        customers: [],
        route: [],
        stops: [],
        latestPosition: null,
        proximity: null,
        summary: null,
      };
    }
    throw error;
  }
}
