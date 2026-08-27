"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LogIn } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { getDefaultRouteForRole } from "@/lib/auth/default-route";

export function LoginForm() {
  const { currentUser, isLoading, login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
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
    router.replace(getDefaultRouteForRole(currentUser.role));
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

      router.replace(getDefaultRouteForRole(result.user.role));
    } catch {
      setError("Impossible de se connecter.");
      setIsSubmitting(false);
    }
  }

  return (
    <Card className="animate-rise animation-delay-150 ring-0 p-7 shadow-[0_24px_70px_rgba(15,23,42,0.08)] sm:p-9 lg:p-10">
      <CardHeader className="text-center">
        <p className="text-2xl font-bold text-emerald-700">COMDIS</p>
        <CardTitle className="mt-6 font-heading text-3xl">Connexion</CardTitle>
        <CardDescription className="mx-auto max-w-xs text-base leading-7">
          Connectez-vous pour accéder à votre espace de travail.
        </CardDescription>
      </CardHeader>

      <CardContent className="mt-8">
        <form
          className="space-y-5"
          aria-label="Formulaire de connexion"
          onSubmit={handleSubmit}
        >
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="caissier@comdis.local"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-12 rounded-2xl px-4 text-sm focus-visible:border-emerald-500 focus-visible:ring-emerald-500/15"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Mot de passe</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="Votre mot de passe"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-12 rounded-2xl px-4 text-sm focus-visible:border-emerald-500 focus-visible:ring-emerald-500/15"
            />
          </div>

          {(error || queryErrorMessage) && (
            <p className="text-sm text-destructive">{error || queryErrorMessage}</p>
          )}

          <Button
            type="submit"
            disabled={isSubmitting}
            aria-label="Se connecter à COMDIS"
            className="mt-2 h-12 w-full rounded-2xl bg-emerald-600 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(5,150,105,0.22)] hover:bg-emerald-700"
          >
            <LogIn aria-hidden="true" className="h-4 w-4" />
            {isSubmitting ? "Connexion..." : "Se connecter"}
          </Button>
        </form>

        <div className="my-8 h-px bg-border" />

        <div className="text-center text-sm">
          <p className="text-muted-foreground/70">Comptes de démonstration</p>
          <p className="mt-2 font-medium text-muted-foreground">
            admin@comdis.local · 123456
          </p>
          <p className="mt-1 font-medium text-muted-foreground">
            caissier@comdis.local · 123456
          </p>
          <p className="mt-1 font-medium text-muted-foreground">
            chauffeur@comdis.local · 123456
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
