import type { Metadata } from "next";

import { ClientLoginForm } from "@/components/client/client-login-form";

export const metadata: Metadata = {
  title: "Espace Client | COMDIS",
  description: "Accedez a votre espace client pour consulter le catalogue et commander en ligne.",
};

export default function ClientLoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-emerald-50/40 px-4 py-8 sm:px-6">
      <ClientLoginForm />
    </main>
  );
}
