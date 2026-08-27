import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { TrajetsView } from "@/components/trajets/trajets-view";
import { getCurrentSessionUser } from "@/lib/server/auth";
import { getTruckRoutesPageData } from "@/lib/server/truck-routes";
import type { UserRole } from "@/types/auth";

export const metadata: Metadata = {
  title: "Trajets",
};

export const dynamic = "force-dynamic";

const allowedRoles: UserRole[] = ["admin", "depot_manager"];

type TrajetsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function TrajetsPage({ searchParams }: TrajetsPageProps) {
  const currentUser = await getCurrentSessionUser();

  if (!currentUser) {
    redirect("/login");
  }

  if (!allowedRoles.includes(currentUser.role)) {
    redirect("/driver");
  }

  const params = await searchParams;
  const data = await getTruckRoutesPageData(params);

  return <TrajetsView initialData={data} />;
}
