import type { Metadata } from "next";

import { UserDialog } from "@/components/users/user-dialog";
import { UsersView } from "@/components/users/users-view";
import { getUsers } from "@/lib/server/users";

export const metadata: Metadata = {
  title: "Utilisateurs",
};

export default async function UtilisateursPage() {
  const users = await getUsers();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            Utilisateurs
          </h1>
          <p className="text-sm text-muted-foreground">
            Comptes et roles d&apos;acces a COMDIS.
          </p>
        </div>

        <UserDialog />
      </div>

      <UsersView initialUsers={users} />
    </div>
  );
}
