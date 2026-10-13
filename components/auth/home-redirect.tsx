"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { getBrowserHomeRoute } from "@/lib/auth/browser-home-route";
import type { UserRole } from "@/types/auth";

export function HomeRedirect({ role, disabledModules }: { role: UserRole; disabledModules?: string[] }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(getBrowserHomeRoute(role, disabledModules));
  }, [role, disabledModules, router]);

  return (
    <main className="flex min-h-dvh items-center justify-center" aria-label="Ouverture de votre espace">
      <Loader2 aria-hidden="true" className="size-6 animate-spin text-primary" />
    </main>
  );
}
