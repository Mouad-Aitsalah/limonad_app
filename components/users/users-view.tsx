"use client";

import * as React from "react";

import { Card, CardContent } from "@/components/ui/card";
import { UserDialog } from "@/components/users/user-dialog";
import { UsersToolbar } from "@/components/users/users-toolbar";
import { UsersTable } from "@/components/users/users-table";
import type { User } from "@/types/user";

export function UsersView({ initialUsers }: { initialUsers: User[] }) {
  const [users, setUsers] = React.useState(initialUsers);
  const [search, setSearch] = React.useState("");
  const [role, setRole] = React.useState("all");
  const [actif, setActif] = React.useState("all");

  const filteredUsers = React.useMemo(() => {
    const query = search.trim().toLowerCase();

    return users.filter((user) => {
      const matchesSearch =
        query.length === 0 ||
        user.nom.toLowerCase().includes(query) ||
        user.email.toLowerCase().includes(query);

      const matchesRole = role === "all" || user.role === role;

      const matchesActif =
        actif === "all" ||
        (actif === "actif" && user.actif) ||
        (actif === "inactif" && !user.actif);

      return matchesSearch && matchesRole && matchesActif;
    });
  }, [users, search, role, actif]);

  function handleUserCreated(user: User) {
    setUsers((current) => [user, ...current]);
  }

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

        <UserDialog onSaved={handleUserCreated} />
      </div>

      <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
        <CardContent className="space-y-5">
          <UsersToolbar
            search={search}
            onSearchChange={setSearch}
            role={role}
            onRoleChange={setRole}
            actif={actif}
            onActifChange={setActif}
          />

          <p className="text-sm text-muted-foreground">
            {filteredUsers.length} utilisateur
            {filteredUsers.length > 1 ? "s" : ""}
          </p>

          <UsersTable users={filteredUsers} />
        </CardContent>
      </Card>
    </div>
  );
}
