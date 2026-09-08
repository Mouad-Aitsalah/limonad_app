"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { getBrowserHomeRoute } from "@/lib/auth/browser-home-route";
import type { UserRole } from "@/types/auth";

export function HomeRedirect({ role }: { role: UserRole }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(getBrowserHomeRoute(role));
  }, [role, router]);

  return (
    <main className="flex min-h-dvh items-center justify-center" aria-label="Ouverture de votre espace">
      <Loader2 aria-hidden="true" className="size-6 animate-spin text-primary" />
    </main>
  );
}
