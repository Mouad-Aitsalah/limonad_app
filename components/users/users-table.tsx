"use client";

import * as React from "react";
import { toast } from "sonner";
import { Eye, KeyRound, MoreHorizontal, Pencil, PowerOff, UsersRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/use-auth";
import { roleLabels } from "@/lib/roles";
import { UserEditDialog } from "@/components/users/user-edit-dialog";
import { UserStatusBadge } from "@/components/users/user-status-badge";
import type { User } from "@/types/user";

function formatLastLogin(date: Date | null) {
  if (!date) return "Jamais connecté";
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type UsersTableProps = {
  users: User[];
  onUserUpdated: (user: User) => void;
};

export function UsersTable({ users, onUserUpdated }: UsersTableProps) {
  const { currentUser } = useAuth();
  const [editingUser, setEditingUser] = React.useState<User | null>(null);

  if (users.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <UsersRound
          aria-hidden="true"
          className="h-10 w-10 text-muted-foreground/40"
        />
        <p className="text-sm text-muted-foreground">
          Aucun utilisateur ne correspond à ces critères.
        </p>
      </div>
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nom</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Rôle</TableHead>
            <TableHead>Statut</TableHead>
            <TableHead>Dernière connexion</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => {
            const isSelf = user.id === currentUser?.id;

            return (
              <TableRow key={user.id}>
                <TableCell className="font-medium text-foreground">
                  <span className="inline-flex items-center gap-2">
                    {user.nom}
                    {isSelf && (
                      <Badge variant="secondary" className="text-[10px]">
                        Vous
                      </Badge>
                    )}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {user.email}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {roleLabels[user.role]}
                </TableCell>
                <TableCell>
                  <UserStatusBadge actif={user.actif} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatLastLogin(user.derniereConnexion)}
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Actions pour ${user.nom}`}
                        />
                      }
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem>
                        <Eye aria-hidden="true" />
                        Voir
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setEditingUser(user)}>
                        <Pencil aria-hidden="true" />
                        Modifier
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          toast.success("Mot de passe réinitialisé (simulation)")
                        }
                      >
                        <KeyRound aria-hidden="true" />
                        Réinitialiser le mot de passe
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={isSelf}
                        title={
                          isSelf
                            ? "Vous ne pouvez pas désactiver votre propre compte"
                            : undefined
                        }
                      >
                        <PowerOff aria-hidden="true" />
                        Désactiver
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <UserEditDialog
        user={editingUser}
        onOpenChange={(open) => {
          if (!open) setEditingUser(null);
        }}
        onSaved={onUserUpdated}
      />
    </>
  );
}
