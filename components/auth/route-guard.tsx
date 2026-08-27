"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import type { UserRole } from "@/types/auth";

type RouteGuardProps = {
  allowedRoles: UserRole[];
  redirectTo: string;
  children: React.ReactNode;
};

export function RouteGuard({ allowedRoles, redirectTo, children }: RouteGuardProps) {
  const { currentUser, isLoading } = useAuth();
  const router = useRouter();

  const isAuthorized =
    !isLoading && !!currentUser && allowedRoles.includes(currentUser.role);

  React.useEffect(() => {
    if (isLoading) return;

    if (!currentUser) {
      router.replace("/login");
      return;
    }

    if (!allowedRoles.includes(currentUser.role)) {
      router.replace(redirectTo);
    }
  }, [isLoading, currentUser, allowedRoles, redirectTo, router]);

  if (!isAuthorized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30">
        <Loader2
          aria-hidden="true"
          className="h-6 w-6 animate-spin text-muted-foreground"
        />
      </div>
    );
  }

  return <>{children}</>;
}
