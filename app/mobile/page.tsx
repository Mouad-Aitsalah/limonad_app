import type { Metadata } from "next";
import { RouteGuard } from "@/components/auth/route-guard";
import { MobileLauncher } from "@/components/mobile/mobile-launcher";

export const metadata: Metadata = {
  title: "Accueil | COMDIS",
};

export default function MobilePage() {
  return (
    <RouteGuard allowedRoles={["super_admin", "admin", "depot_manager", "cashier", "driver"]} redirectTo="/login">
      <MobileLauncher />
    </RouteGuard>
  );
}
