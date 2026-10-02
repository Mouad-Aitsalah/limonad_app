import type { Metadata } from "next";
import { Suspense } from "react";

import { LoginForm } from "@/components/auth/login-form";
import { LoginInfo } from "@/components/auth/login-info";

export const metadata: Metadata = {
  title: "Connexion | COMDIS",
  description: "Connectez-vous a votre espace de travail COMDIS.",
};

export default function LoginPage() {
  return (
    <main className="grid min-h-screen bg-[#eef4fb] lg:grid-cols-[56fr_44fr]">
      <LoginInfo />
      <div className="flex items-center justify-center px-4 py-8 sm:px-8 lg:px-10 xl:px-14">
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
