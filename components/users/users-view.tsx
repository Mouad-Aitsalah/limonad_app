"use client";

import * as React from "react";

import { Card, CardContent } from "@/components/ui/card";
import { UsersToolbar } from "@/components/users/users-toolbar";
import { UsersTable } from "@/components/users/users-table";
import type { User } from "@/types/user";

export function UsersView({ initialUsers }: { initialUsers: User[] }) {
  const [search, setSearch] = React.useState("");
  const [role, setRole] = React.useState("all");
  const [actif, setActif] = React.useState("all");

  const filteredUsers = React.useMemo(() => {
    const query = search.trim().toLowerCase();

    return initialUsers.filter((user) => {
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
  }, [initialUsers, search, role, actif]);

  return (
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
  );
}
