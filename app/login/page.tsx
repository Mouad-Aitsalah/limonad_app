import type { Metadata } from "next";
import { Suspense } from "react";

import { LoginForm } from "@/components/auth/login-form";
import { LoginInfo } from "@/components/auth/login-info";

export const metadata: Metadata = {
  title: "Connexion | COMDIS",
  description: "Connectez-vous a votre espace de travail COMDIS.",
};

// The app-wide `--font-geist-sans` variable is not defined anywhere (no
// next/font in the root layout), so text would fall back to the browser's
// default serif. The login page sets its own system sans-serif stack;
// headings opt into serif with `font-serif`.
const LOGIN_SANS_FONT =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export default function LoginPage() {
  return (
    <main
      style={{ fontFamily: LOGIN_SANS_FONT }}
      className="grid min-h-screen bg-[#EAF2FC] lg:grid-cols-[59fr_41fr]"
    >
      <LoginInfo />
      <div className="flex items-center justify-center px-4 py-8 sm:px-8 lg:px-8 xl:px-10">
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
