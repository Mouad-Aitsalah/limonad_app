"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

/** "Retour" to the first page still available + "Se déconnecter" (never locks the user in). */
export function ModuleUnavailableActions({ homeHref }: { homeHref: string | null }) {
  const { logout } = useAuth();
  const router = useRouter();
  const [leaving, setLeaving] = React.useState(false);

  async function handleLogout() {
    setLeaving(true);
    await logout();
    router.push("/login");
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
      {homeHref ? (
        <Button nativeButton={false} render={<Link href={homeHref} />}>
          Aller à une page disponible
        </Button>
      ) : null}
      <Button type="button" variant="outline" disabled={leaving} onClick={() => void handleLogout()}>
        <LogOut aria-hidden="true" className="h-4 w-4" />
        Se déconnecter
      </Button>
    </div>
  );
}
