import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EmployeeDetailView } from "@/components/employees/employee-detail-view";
import { OperationsServiceError } from "@/lib/server/depots";
import { getEmployeeDetail } from "@/lib/server/employees";

type EmployeeDetailPageProps = {
  params: Promise<{ id: string }>;
};

export const metadata: Metadata = {
  title: "Detail employe",
};

export const dynamic = "force-dynamic";

export default async function EmployeeDetailPage({ params }: EmployeeDetailPageProps) {
  const { id } = await params;
  const detail = await loadEmployeeDetail(id);

  return <EmployeeDetailView detail={detail} />;
}

async function loadEmployeeDetail(id: string) {
  try {
    return await getEmployeeDetail(id);
  } catch (error) {
    if (error instanceof OperationsServiceError && error.status === 404) {
      notFound();
    }
    throw error;
  }
}
