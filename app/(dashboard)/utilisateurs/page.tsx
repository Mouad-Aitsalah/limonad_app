import type { Metadata } from "next";

import { UsersView } from "@/components/users/users-view";
import { getUsers } from "@/lib/server/users";

export const metadata: Metadata = {
  title: "Utilisateurs",
};

export default async function UtilisateursPage() {
  const users = await getUsers();

  return <UsersView initialUsers={users} />;
}
