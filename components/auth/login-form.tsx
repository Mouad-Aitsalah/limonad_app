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
      // Read the fields themselves: a browser autofill can fill them without
      // React having seen a change event yet.
      const form = new FormData(event.currentTarget);
      const emailValue = String(form.get("email") ?? email);
      const passwordValue = String(form.get("password") ?? password);
      const result = await login(emailValue.trim(), passwordValue);
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

  const fieldClass =
    "h-[52px] [@media(max-height:850px)]:h-12 rounded-xl border-slate-200 bg-white px-4 pl-12 text-base shadow-none transition placeholder:text-slate-400 focus-visible:border-[#00845F] focus-visible:ring-[#00845F]/20";
  const iconClass = "pointer-events-none absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-slate-500";

  return (
    <div className="w-full max-w-[550px] rounded-[20px] bg-white px-6 py-9 shadow-[0_24px_70px_rgba(16,43,78,0.10)] ring-1 ring-slate-200/50 motion-safe:animate-rise sm:px-10 sm:py-12 [@media(max-height:850px)]:py-6">
      <LoginBrand layout="stacked" />

      <div className="mt-9 text-center [@media(max-height:850px)]:mt-5">
        <h1 className="font-serif text-[34px] leading-tight font-bold text-[#102B4C]">
          Connexion
        </h1>
        <p className="mt-2 text-lg text-slate-500">Accédez à votre espace de travail</p>
      </div>

      <form className="mt-9 space-y-6 [@media(max-height:850px)]:mt-5 [@media(max-height:850px)]:space-y-4" aria-label="Formulaire de connexion" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="email" className="text-base font-semibold text-[#102B4C]">
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
          <Label htmlFor="password" className="text-base font-semibold text-[#102B4C]">
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
              className="absolute top-1/2 right-2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:ring-2 focus-visible:ring-[#00966D]/40 focus-visible:outline-none"
            >
              {showPassword ? (
                <EyeOff aria-hidden="true" className="h-5 w-5" />
              ) : (
                <Eye aria-hidden="true" className="h-5 w-5" />
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
          disabled={isSubmitting}
          aria-label="Se connecter à COMDIS"
          className="h-[54px] [@media(max-height:850px)]:h-12 w-full rounded-xl bg-none bg-[#00845F] text-lg font-semibold text-white shadow-[0_12px_28px_rgba(0,132,95,0.25)] transition duration-200 hover:bg-[#007653] hover:shadow-[0_14px_30px_rgba(0,132,95,0.32)] disabled:opacity-75 disabled:shadow-none"
        >
          <LogIn aria-hidden="true" className="h-5 w-5" />
          {isSubmitting ? "Connexion..." : "Se connecter"}
        </Button>
      </form>

      <div className="mt-9 flex items-center gap-4 rounded-2xl bg-[#e8f6f0] px-5 py-5 [@media(max-height:850px)]:mt-5 [@media(max-height:850px)]:py-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#d3eee3] text-[#00845F]">
          <ShieldCheck aria-hidden="true" className="h-5 w-5" />
        </span>
        <p className="text-sm leading-6 text-slate-500">
          <span className="block text-base font-semibold text-[#102B4C]">Accès sécurisé</span>
          Votre session est protégée. Accès réservé aux utilisateurs autorisés.
        </p>
      </div>
    </div>
  );
}
