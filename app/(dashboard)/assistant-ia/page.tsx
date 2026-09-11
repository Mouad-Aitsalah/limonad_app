import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AssistantChat } from "@/components/assistant/assistant-chat";
import { AuthServiceError } from "@/lib/server/auth";
import { requireOrganizationUser } from "@/lib/server/organization-context";

export const metadata: Metadata = {
  title: "Assistant IA",
};

export default async function AssistantIaPage() {
  try {
    await requireOrganizationUser(["admin"]);
  } catch (error) {
    if (error instanceof AuthServiceError) {
      redirect("/dashboard");
    }
    throw error;
  }

  return <AssistantChat />;
}
