import { BarChart3, Boxes, Building2, Lock, Globe2, ShoppingCart, Users } from "lucide-react";

import { LoginBrand } from "@/components/auth/login-brand";
import { LoginDashboardIllustration } from "@/components/auth/login-dashboard-illustration";

const features = [
  {
    title: "Ventes & Caisse",
    description: "Gestion des factures, paiements et suivi des ventes en temps réel.",
    icon: ShoppingCart,
    iconClass: "bg-emerald-500/25 text-emerald-300",
  },
  {
    title: "Stocks & Achats",
    description: "Suivi des stocks, achats et réapprovisionnements.",
    icon: Boxes,
    iconClass: "bg-sky-500/25 text-sky-300",
  },
  {
    title: "Clients & Fournisseurs",
    description: "Gestion complète de vos contacts et soldes.",
    icon: Users,
    iconClass: "bg-violet-500/25 text-violet-300",
  },
  {
    title: "Rapports & Analyses",
    description: "Tableaux de bord et statistiques pour de meilleures décisions.",
    icon: BarChart3,
    iconClass: "bg-amber-500/25 text-amber-300",
  },
] as const;

const highlights = [
  { title: "Multi-sociétés", description: "Gérez plusieurs dépôts.", icon: Building2 },
  { title: "Sécurisé", description: "Vos données sont protégées.", icon: Lock },
  { title: "Toujours disponible", description: "Accès depuis n'importe où.", icon: Globe2 },
] as const;

/**
 * Left presentation panel of /login (desktop only, >= lg). The background is a
 * local illustration (public/login/store-bg.svg - swap the file to use a real
 * photograph) under a semi-transparent navy veil.
 */
export function LoginInfo() {
  return (
    <section
      aria-label="Présentation de COMDIS Manager"
      className="relative isolate hidden min-h-screen flex-col overflow-hidden bg-[#102B4E] text-white lg:flex"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-20 bg-cover bg-center"
        style={{ backgroundImage: "url(/login/store-bg.svg)" }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(16,43,78,0.9)_0%,rgba(16,43,78,0.84)_45%,rgba(11,31,61,0.95)_100%)]"
      />

      <div className="flex flex-1 flex-col px-10 pt-8 xl:px-14 xl:pt-10 2xl:px-20">
        <header className="flex items-start justify-between gap-4">
          <LoginBrand tone="light" />
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-sm font-medium text-white/90 backdrop-blur-sm">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-400" />
            Solution ERP
          </span>
        </header>

        <div className="mt-10 max-w-2xl xl:mt-12">
          <h1 className="font-serif text-4xl leading-[1.1] font-semibold tracking-tight text-white xl:text-5xl 2xl:text-6xl">
            Gérez toute votre entreprise{" "}
            <span className="text-[#19c595]">au même endroit.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-white/75 xl:text-lg">
            Une plateforme complète pour piloter vos ventes, achats, stocks, clients,
            fournisseurs et la performance de votre activité.
          </p>
        </div>

        <ul className="mt-8 grid max-w-3xl grid-cols-2 gap-3 xl:gap-4">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <li
                key={feature.title}
                className="group flex items-start gap-3.5 rounded-2xl border border-white/12 bg-white/8 p-4 backdrop-blur-sm transition duration-300 hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/12 motion-reduce:transition-none motion-reduce:hover:translate-y-0 xl:p-5"
              >
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${feature.iconClass}`}
                >
                  <Icon aria-hidden="true" className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-[15px] font-semibold text-white">{feature.title}</h2>
                  <p className="mt-1 text-[13px] leading-5 text-white/65">
                    {feature.description}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="mt-auto flex justify-center pt-6 [@media(max-height:799px)]:hidden">
          <LoginDashboardIllustration className="h-[24vh] max-h-[300px] w-auto max-w-full drop-shadow-[0_24px_30px_rgba(0,0,0,0.35)]" />
        </div>
      </div>

      <footer className="border-t border-white/10 bg-[#0b1f3d]/70 px-10 py-4 backdrop-blur-md xl:px-14 2xl:px-20">
        <ul className="grid grid-cols-3 gap-4">
          {highlights.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.title} className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-emerald-300">
                  <Icon aria-hidden="true" className="h-4 w-4" />
                </span>
                <p className="text-[13px] leading-4 text-white/65">
                  <span className="block text-sm font-semibold text-white">{item.title}</span>
                  {item.description}
                </p>
              </li>
            );
          })}
        </ul>
      </footer>
    </section>
  );
}
