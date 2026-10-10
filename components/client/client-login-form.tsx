"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, ShoppingBag } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Espace Client login: organisation code + customer code (both mandatory),
 * optional phone (contact info only, never an identity proof). No password
 * or PIN by business decision - see lib/server/client-auth.ts.
 */
export function ClientLoginForm() {
  const router = useRouter();
  const [organizationCode, setOrganizationCode] = React.useState("");
  const [customerCode, setCustomerCode] = React.useState("");
  const [phone, setPhone] = React.useState("");
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
        body: JSON.stringify({ organizationCode, customerCode, phone: phone.trim() || undefined }),
      });
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        setError(body.message ?? "Impossible de se connecter.");
        setIsSubmitting(false);
        return;
      }
      router.replace("/client/catalog");
    } catch {
      setError("Impossible de se connecter. Vérifiez votre connexion.");
      setIsSubmitting(false);
    }
  }

  return (
    <Card className="w-full max-w-md ring-0 p-7 shadow-[0_24px_70px_rgba(15,23,42,0.08)] sm:p-9">
      <CardHeader className="gap-3 px-0">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
          <ShoppingBag aria-hidden="true" className="h-6 w-6" />
        </div>
        <CardTitle className="font-heading text-2xl font-semibold">Commander en ligne</CardTitle>
        <CardDescription>
          Entrez le code de votre fournisseur et votre code client pour accéder au catalogue et passer commande.
        </CardDescription>
      </CardHeader>

      <CardContent className="px-0 pt-2">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="client-org-code">Code organisation</Label>
            <Input
              id="client-org-code"
              type="text"
              required
              autoComplete="organization"
              value={organizationCode}
              onChange={(event) => setOrganizationCode(event.target.value)}
              placeholder="Fourni par votre fournisseur"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="client-customer-code">Code client</Label>
            <Input
              id="client-customer-code"
              type="text"
              required
              autoComplete="off"
              value={customerCode}
              onChange={(event) => setCustomerCode(event.target.value)}
              placeholder="Ex. 3421/15"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="client-phone">
              Téléphone <span className="font-normal text-muted-foreground">(facultatif)</span>
            </Label>
            <Input
              id="client-phone"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="Pour vous recontacter au sujet de la commande"
            />
          </div>

          {error ? (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Connexion..." : "Accéder au catalogue"}
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Button>
        </form>

        <Link
          href="/login"
          className="mt-5 flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
          Retour à la connexion
        </Link>
      </CardContent>
    </Card>
  );
}
