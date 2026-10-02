import { BarChart3, Building2, Cloud, Package, ShieldCheck, ShoppingCart, Users } from "lucide-react";

import { LoginBrand } from "@/components/auth/login-brand";
import { LoginDashboardIllustration } from "@/components/auth/login-dashboard-illustration";

const features = [
  {
    title: "Ventes & Caisse",
    description: "Gestion des factures, paiements et suivi des ventes en temps réel.",
    icon: ShoppingCart,
    iconClass: "bg-[#12805f]",
  },
  {
    title: "Stocks & Achats",
    description: "Suivi des stocks, achats et réapprovisionnements.",
    icon: Package,
    iconClass: "bg-[#2f64c4]",
  },
  {
    title: "Clients & Fournisseurs",
    description: "Gestion complète de vos contacts et soldes.",
    icon: Users,
    iconClass: "bg-[#b8743a]",
  },
  {
    title: "Rapports & Analyses",
    description: "Tableaux de bord et statistiques pour de meilleures décisions.",
    icon: BarChart3,
    iconClass: "bg-[#5a47b8]",
  },
] as const;

const highlights = [
  { title: "Multi-sociétés", description: "Gérez plusieurs dépôts", icon: Building2, iconClass: "bg-[#4b4aa8]" },
  { title: "Sécurisé", description: "Vos données sont protégées", icon: ShieldCheck, iconClass: "bg-[#12805f]" },
  { title: "Toujours disponible", description: "Accès depuis n'importe où", icon: Cloud, iconClass: "bg-[#2f64c4]" },
] as const;

/**
 * Left presentation panel of /login (desktop only, >= lg). The background is a
 * local image (public/login/store-bg.svg - point BACKGROUND_URL at a real
 * photograph, e.g. /login/store-bg.jpg, to use one) under a semi-transparent
 * navy veil.
 */
const BACKGROUND_URL = "/login/store-bg.svg";

export function LoginInfo() {
  return (
    <section
      aria-label="Présentation de COMDIS Manager"
      className="relative isolate hidden min-h-screen flex-col overflow-hidden bg-[#102B4E] text-white lg:flex"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-20 bg-cover bg-center"
        style={{ backgroundImage: `url(${BACKGROUND_URL})` }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[linear-gradient(100deg,rgba(14,37,71,0.92)_0%,rgba(14,37,71,0.7)_55%,rgba(14,37,71,0.55)_100%)]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 -z-10 h-1/3 bg-[linear-gradient(0deg,rgba(10,26,50,0.55)_0%,transparent_100%)]"
      />

      <div className="flex flex-1 flex-col px-8 pt-7 xl:px-16 xl:pt-9 2xl:px-24 2xl:pt-12">
        <header className="flex items-start justify-between gap-4">
          <LoginBrand tone="light" />
          <span className="inline-flex items-center gap-2.5 rounded-full border border-white/15 bg-[#0e2547]/55 px-5 py-2.5 text-[15px] font-medium text-white/90 backdrop-blur-sm">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-[#19d49b]" />
            Solution ERP
          </span>
        </header>

        <div className="mt-6 max-w-[34rem] xl:mt-12">
          <h1 className="font-serif text-[34px] leading-[1.08] font-bold xl:text-[44px] tracking-tight text-white 2xl:text-[56px]">
            Gérez toute votre entreprise{" "}
            <span className="text-[#19d49b]">au même endroit.</span>
          </h1>
          <p className="mt-4 max-w-[32rem] text-[15px] leading-6 text-white/85 xl:mt-5 xl:text-lg xl:leading-8">
            Une plateforme complète pour piloter vos ventes, achats, stocks, clients,
            fournisseurs et la performance de votre activité.
          </p>
        </div>

        <ul className="mt-5 grid max-w-[40rem] grid-cols-2 gap-3 xl:mt-8 xl:gap-4">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <li
                key={feature.title}
                className="group flex items-center gap-3 rounded-2xl border border-white/10 bg-[#0e2547]/55 px-3 py-3 backdrop-blur-sm xl:gap-4 xl:px-4 xl:py-4 transition duration-300 hover:-translate-y-0.5 hover:border-white/25 hover:bg-[#0e2547]/70 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                <span
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white shadow xl:h-14 xl:w-14-[0_8px_18px_rgba(0,0,0,0.25)] ${feature.iconClass}`}
                >
                  <Icon aria-hidden="true" className="h-6 w-6" />
                </span>
                <div>
                  <h2 className="font-serif text-[17px] leading-tight font-semibold text-white">
                    {feature.title}
                  </h2>
                  <p className="mt-1 text-[12.5px] leading-[1.35] text-white/75 xl:text-[13.5px]">
                    {feature.description}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="relative mt-auto min-h-[8rem] flex-1 [@media(max-height:799px)]:hidden">
          <LoginDashboardIllustration className="absolute -bottom-20 left-1/2 h-[calc(100%+5rem)] max-h-[420px] w-auto max-w-[115%] drop-shadow-[0_28px_34px_rgba(0,0,0,0.45)] [transform:translateX(-45%)_perspective(1400px)_rotateY(9deg)]" />
        </div>
      </div>

      <footer className="relative mx-5 mb-5 rounded-2xl border border-white/10 bg-[#0e2547]/70 px-4 py-3 xl:px-6 xl:py-4 backdrop-blur-md xl:mx-10 2xl:mx-16">
        <ul className="grid grid-cols-3 divide-x divide-white/10">
          {highlights.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.title} className="flex items-center gap-3 px-3 first:pl-0 last:pr-0">
                <span
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white ${item.iconClass}`}
                >
                  <Icon aria-hidden="true" className="h-5 w-5" />
                </span>
                <p className="text-[12.5px] leading-5 text-white/70 xl:whitespace-nowrap">
                  <span className="block font-serif text-[15px] font-semibold xl:whitespace-nowrap text-white">
                    {item.title}
                  </span>
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
