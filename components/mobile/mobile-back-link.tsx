import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { MOBILE_HOME_ROUTE } from "@/lib/auth/browser-home-route";

export function MobileBackLink() {
  return (
    <Link
      href={MOBILE_HOME_ROUTE}
      aria-label="Retour à l’accueil mobile"
      className="flex size-11 shrink-0 touch-manipulation items-center justify-center rounded-2xl border border-border/70 bg-white/80 text-foreground transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary lg:hidden"
    >
      <ArrowLeft aria-hidden="true" className="size-5" />
    </Link>
  );
}
