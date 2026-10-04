"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ShoppingBag } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * CLIENT PLATFORM (branch `client-platform`) - V1 login: email + organisation
 * code, no password (see lib/server/client-auth.ts's own doc comment on why
 * this is the deliberate scope of this first version).
 */
export function ClientLoginForm() {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [organizationCode, setOrganizationCode] = React.useState("");
  const [error, setError] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/client/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, organizationCode }),
      });
      const body = (await response.json()) as { message?: string };
      if (!response.ok) {
        setError(body.message ?? "Impossible de se connecter.");
        setIsSubmitting(false);
        return;
      }
      router.replace("/client/catalog");
    } catch {
      setError("Impossible de se connecter. Verifiez votre connexion.");
      setIsSubmitting(false);
    }
  }

  return (
    <Card className="w-full max-w-md ring-0 p-7 shadow-[0_24px_70px_rgba(15,23,42,0.08)] sm:p-9">
      <CardHeader className="gap-3 px-0">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
          <ShoppingBag aria-hidden="true" className="h-6 w-6" />
        </div>
        <CardTitle className="font-heading text-2xl font-semibold">
          Commander en ligne
        </CardTitle>
        <CardDescription>
          Entrez votre email et le code fourni par votre fournisseur pour accéder à son catalogue.
        </CardDescription>
      </CardHeader>

      <CardContent className="px-0 pt-2">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="client-email">Email</Label>
            <Input
              id="client-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="vous@exemple.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="client-org-code">Code organisation</Label>
            <Input
              id="client-org-code"
              type="text"
              required
              value={organizationCode}
              onChange={(event) => setOrganizationCode(event.target.value)}
              placeholder="Fourni par votre fournisseur"
            />
          </div>

          {error ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Connexion..." : "Accéder au catalogue"}
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
