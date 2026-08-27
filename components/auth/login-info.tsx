import { Boxes, Building2, ShieldCheck, Zap } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const features = [
  {
    title: "Multi Organisations",
    description: "Gerez plusieurs societes.",
    icon: Building2,
  },
  {
    title: "Acces securise",
    description: "Connexion securisee.",
    icon: ShieldCheck,
  },
  {
    title: "Gestion de Stock",
    description: "Suivi des stocks en temps reel.",
    icon: Boxes,
  },
  {
    title: "Performance",
    description: "Rapide et optimise.",
    icon: Zap,
  },
] as const;

export function LoginInfo() {
  return (
    <Card className="animate-rise ring-0 p-7 shadow-[0_24px_70px_rgba(15,23,42,0.08)] sm:p-9 lg:p-10">
      <CardHeader className="gap-5">
        <p className="text-sm font-semibold text-emerald-700">COMDIS ERP</p>
        <CardTitle className="max-w-2xl font-heading text-4xl leading-[1.12] font-semibold sm:text-5xl lg:text-6xl">
          Pilotez votre entreprise depuis une interface simple, rapide et
          moderne.
        </CardTitle>
        <CardDescription className="max-w-xl text-base leading-7 sm:text-lg">
          Gerez vos achats, ventes, stock, fournisseurs, clients et rapports
          depuis une plateforme unique.
        </CardDescription>
      </CardHeader>

      <CardContent className="mt-9 grid gap-4 sm:grid-cols-2">
        {features.map((feature) => {
          const Icon = feature.icon;

          return (
            <article
              className="group rounded-2xl border border-border bg-muted/40 p-5 transition duration-300 hover:-translate-y-1 hover:border-emerald-200 hover:bg-white hover:shadow-[0_18px_35px_rgba(15,23,42,0.08)] dark:hover:bg-card"
              key={feature.title}
            >
              <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50 text-emerald-700 transition duration-300 group-hover:bg-emerald-600 group-hover:text-white">
                <Icon aria-hidden="true" className="h-5 w-5" />
              </div>
              <h2 className="text-base font-semibold text-foreground">
                {feature.title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {feature.description}
              </p>
            </article>
          );
        })}
      </CardContent>
    </Card>
  );
}
