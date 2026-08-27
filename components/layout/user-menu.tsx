"use client";

import { useRouter } from "next/navigation";
import { LogOut, Settings, User } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";

function initials(nom: string) {
  return nom
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase())
    .slice(0, 2)
    .join("");
}

function roleLabel(role: string) {
  switch (role) {
    case "admin":
      return "Admin";
    case "depot_manager":
      return "Depot";
    case "cashier":
      return "Caisse";
    case "driver":
      return "Chauffeur";
    default:
      return "Compte";
  }
}

type UserMenuProps = {
  userName: string;
  userRole: string;
  userEmail: string;
};

export function UserMenu({ userName, userRole, userEmail }: UserMenuProps) {
  const { logout } = useAuth();
  const router = useRouter();

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="surface-card-muted flex min-w-[220px] items-center gap-3 rounded-[22px] px-3 py-2.5 text-left outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-4 focus-visible:ring-ring/12"
        aria-label="Menu utilisateur"
      >
        <Avatar className="h-11 w-11">
          <AvatarFallback className="bg-[linear-gradient(135deg,#173156_0%,#0f7a5d_100%)] text-sm font-semibold text-white">
            {initials(userName)}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
            {userName}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <span className="rounded-full bg-[var(--surface-soft)] px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">
              {roleLabel(userRole)}
            </span>
            <span className="truncate text-xs text-[var(--text-secondary)]">COMDIS</span>
          </div>
        </div>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-64 rounded-3xl p-2">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="rounded-2xl bg-[var(--surface-muted)] px-3 py-3">
            <p className="text-sm font-semibold text-[var(--text-primary)]">{userName}</p>
            <p className="mt-1 text-xs font-normal text-[var(--text-secondary)]">{userEmail}</p>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem>
            <User aria-hidden="true" />
            Profil
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Settings aria-hidden="true" />
            Parametres
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem variant="destructive" onClick={handleLogout}>
            <LogOut aria-hidden="true" />
            Deconnexion
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
