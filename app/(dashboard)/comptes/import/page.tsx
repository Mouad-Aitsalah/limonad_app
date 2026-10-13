import type { Metadata } from "next";

import { AccountsImportPreview } from "@/components/comptes/accounts-import-preview";
import { requireModulePage } from "@/lib/server/module-guard";

export const metadata: Metadata = { title: "Import des comptes" };

export default async function AccountsImportPage() {
  await requireModulePage("accounts");
  return <AccountsImportPreview />;
}
