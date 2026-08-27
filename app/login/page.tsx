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
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-8 sm:px-6 lg:px-8">
      <div className="grid w-full max-w-[1200px] items-stretch gap-6 lg:grid-cols-[1.35fr_0.85fr]">
        <LoginInfo />
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
