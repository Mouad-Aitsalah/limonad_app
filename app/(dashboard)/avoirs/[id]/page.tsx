import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { CreditNoteDetailView } from "@/components/credit-notes/credit-note-detail-view";
import { getCurrentSessionUser } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { getCreditNoteById } from "@/lib/server/credit-notes";
import type { CurrentUser, UserRole } from "@/types/auth";

type CreditNoteDetailPageProps = {
  params: Promise<{ id: string }>;
};

export const metadata: Metadata = {
  title: "Detail avoir",
};

export const dynamic = "force-dynamic";

const allowedRoles: UserRole[] = ["admin", "depot_manager", "cashier"];

export default async function CreditNoteDetailPage({
  params,
}: CreditNoteDetailPageProps) {
  const { id } = await params;
  const currentUser = await getCurrentSessionUser();

  if (!currentUser) {
    redirect("/login");
  }

  if (!allowedRoles.includes(currentUser.role)) {
    redirect("/driver");
  }

  const creditNote = await loadCreditNote(id, currentUser);

  return <CreditNoteDetailView creditNote={creditNote} />;
}

async function loadCreditNote(
  id: string,
  currentUser: CurrentUser,
) {
  try {
    return await getCreditNoteById(id, currentUser);
  } catch (error) {
    if (error instanceof OperationsServiceError && error.status === 404) {
      notFound();
    }
    throw error;
  }
}
