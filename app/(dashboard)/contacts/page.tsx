import type { Metadata } from "next";

import { ContactsView } from "@/components/contacts/contacts-view";
import { getContacts } from "@/lib/server/contacts";
import { getSupplierPartners } from "@/lib/server/suppliers";

export const metadata: Metadata = {
  title: "Contacts",
};

export default async function ContactsPage() {
  const [{ items, summary }, suppliers] = await Promise.all([
    getContacts(),
    getSupplierPartners(),
  ]);

  return (
    <ContactsView
      initialContacts={items}
      initialSummary={summary}
      suppliers={suppliers.filter((supplier) => supplier.active)}
    />
  );
}
