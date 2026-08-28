"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UserEditForm } from "@/components/users/user-edit-form";
import type { User } from "@/types/user";

type UserEditDialogProps = {
  user: User | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (user: User) => void;
};

export function UserEditDialog({ user, onOpenChange, onSaved }: UserEditDialogProps) {
  const isDriver = user?.role === "driver" && !!user.driver;

  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Modifier utilisateur</DialogTitle>
          <DialogDescription>
            {isDriver
              ? "Informations du compte et affectation du camion."
              : "Informations du compte."}
          </DialogDescription>
        </DialogHeader>

        {user && (
          <UserEditForm
            // Remounts the form whenever a different user is opened, so its
            // internal state (selected truck, etc.) always starts fresh
            // from that user's own data - same pattern as UserForm in
            // user-dialog.tsx.
            key={user.id}
            user={user}
            onCancel={() => onOpenChange(false)}
            onSaved={(updated) => {
              onSaved(updated);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
