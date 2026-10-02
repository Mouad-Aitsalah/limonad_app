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
    <main className="grid min-h-screen bg-[linear-gradient(180deg,#f1f5fb_0%,#e8eff9_100%)] lg:grid-cols-[58fr_42fr]">
      <LoginInfo />
      <div className="flex items-center justify-center px-4 py-8 sm:px-8 lg:px-8 xl:px-10">
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
