import type { Metadata } from "next";

import { UsersView } from "@/components/users/users-view";
import { getUsers } from "@/lib/server/users";
import { requireModulePage } from "@/lib/server/module-guard";

export const metadata: Metadata = {
  title: "Utilisateurs",
};

export default async function UtilisateursPage() {
  await requireModulePage("users");
  const users = await getUsers();

  return <UsersView initialUsers={users} />;
}
