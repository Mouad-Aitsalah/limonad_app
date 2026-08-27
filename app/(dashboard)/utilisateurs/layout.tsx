import { RouteGuard } from "@/components/auth/route-guard";

export default function UtilisateursLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <RouteGuard allowedRoles={["admin"]} redirectTo="/dashboard">
      {children}
    </RouteGuard>
  );
}
