import type { Metadata } from "next";

import { AccountsImportPreview } from "@/components/comptes/accounts-import-preview";

export const metadata: Metadata = { title: "Import des comptes" };

export default function AccountsImportPage() {
  return <AccountsImportPreview />;
}
