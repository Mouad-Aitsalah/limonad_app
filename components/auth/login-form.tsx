"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, LockKeyhole, LogIn, Mail, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoginBrand } from "@/components/auth/login-brand";
import { useAuth } from "@/hooks/use-auth";
import { getBrowserHomeRoute } from "@/lib/auth/browser-home-route";

export function LoginForm() {
  const { currentUser, isLoading, login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [error, setError] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const queryError = searchParams.get("error");
  const queryErrorMessage =
    queryError === "invalid_credentials"
      ? "Email ou mot de passe incorrect."
      : queryError === "inactive_account"
        ? "Compte inactif ou bloque."
        : queryError === "login_failed"
          ? "Impossible de se connecter."
          : queryError
            ? "Connexion impossible."
            : "";

  React.useEffect(() => {
    if (isLoading || !currentUser) return;
    router.replace(getBrowserHomeRoute(currentUser.role));
  }, [isLoading, currentUser, router]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const result = await login(email.trim(), password);
      if (!result.success) {
        setError(result.error);
        setIsSubmitting(false);
        return;
      }

      router.replace(getBrowserHomeRoute(result.user.role));
    } catch {
      setError("Impossible de se connecter.");
      setIsSubmitting(false);
    }
  }

  const isFormValid = email.trim().length > 0 && password.length > 0;
  const fieldClass =
    "h-12 rounded-xl border-slate-200 bg-white px-4 pl-11 text-[15px] shadow-none transition focus-visible:border-[#00966D] focus-visible:ring-[#00966D]/20";
  const iconClass = "pointer-events-none absolute top-1/2 left-4 h-[18px] w-[18px] -translate-y-1/2 text-slate-400";

  return (
    <div className="w-full max-w-[520px] rounded-[28px] bg-white px-6 py-8 shadow-[0_24px_70px_rgba(16,43,78,0.12)] ring-1 ring-slate-200/60 motion-safe:animate-rise sm:px-10 sm:py-10">
      <LoginBrand layout="stacked" />

      <div className="mt-8 text-center">
        <h1 className="font-serif text-[32px] leading-tight font-semibold text-[#102B4E]">
          Connexion
        </h1>
        <p className="mt-2 text-[15px] text-slate-500">Accédez à votre espace de travail</p>
      </div>

      <form className="mt-8 space-y-5" aria-label="Formulaire de connexion" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="email" className="text-sm font-semibold text-[#102B4E]">
            Email
          </Label>
          <div className="relative">
            <Mail aria-hidden="true" className={iconClass} />
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="votre@email.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={fieldClass}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="password" className="text-sm font-semibold text-[#102B4E]">
            Mot de passe
          </Label>
          <div className="relative">
            <LockKeyhole aria-hidden="true" className={iconClass} />
            <Input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Votre mot de passe"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={`${fieldClass} pr-12`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
              aria-pressed={showPassword}
              className="absolute top-1/2 right-2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:ring-2 focus-visible:ring-[#00966D]/40 focus-visible:outline-none"
            >
              {showPassword ? (
                <EyeOff aria-hidden="true" className="h-[18px] w-[18px]" />
              ) : (
                <Eye aria-hidden="true" className="h-[18px] w-[18px]" />
              )}
            </button>
          </div>
        </div>

        {(error || queryErrorMessage) && (
          <p role="alert" className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700">
            {error || queryErrorMessage}
          </p>
        )}

        <Button
          type="submit"
          disabled={isSubmitting || !isFormValid}
          aria-label="Se connecter à COMDIS"
          className="h-12 w-full rounded-xl bg-[linear-gradient(90deg,#102B4E_0%,#00966D_100%)] text-[15px] font-bold text-white shadow-[0_12px_28px_rgba(0,150,109,0.25)] transition duration-200 hover:brightness-110 hover:shadow-[0_14px_30px_rgba(0,150,109,0.32)] disabled:opacity-60 disabled:shadow-none"
        >
          <LogIn aria-hidden="true" className="h-[18px] w-[18px]" />
          {isSubmitting ? "Connexion..." : "Se connecter"}
        </Button>
      </form>

      <div className="mt-8 flex items-start gap-3 rounded-2xl bg-emerald-50 px-4 py-3.5">
        <ShieldCheck aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[#00966D]" />
        <p className="text-[13px] leading-5 text-slate-600">
          <span className="block text-sm font-semibold text-[#102B4E]">Accès sécurisé</span>
          Votre session est protégée. Accès réservé aux utilisateurs autorisés.
        </p>
      </div>
    </div>
  );
}
