import { BarChart3, Building2, Cloud, Package, ShieldCheck, ShoppingCart, Users } from "lucide-react";

import { LoginBrand } from "@/components/auth/login-brand";

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
    description: "Gestion complète des contacts et soldes.",
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

// Local images (never a remote URL). Replace the files, keeping the names, or
// point these constants at other files in /public/login:
//  - BACKGROUND_URL: photo of a bright, well-stocked grocery aisle (Jack Lee,
//    Unsplash License - free for commercial use, no attribution required;
//    https://unsplash.com/photos/IH65r4HEQWQ), lightly blurred and tinted navy;
//  - COUNTER_PHOTO: photo of the counter, scanner and laptop showing the
//    dashboard, anchored to the bottom of the panel (cropped from the design
//    reference - swap it for the final photograph when available).
const BACKGROUND_URL = "/login/store-bg.webp";
const COUNTER_PHOTO = "/login/store-counter.webp";

/**
 * Left presentation panel of /login (desktop only, >= lg), under a
 * semi-transparent navy veil so the text stays readable.
 */
export function LoginInfo() {
  return (
    <section
      aria-label="Présentation de COMDIS Manager"
      className="relative isolate hidden min-h-screen flex-col overflow-hidden bg-[#102B4C] text-white lg:flex"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-30 bg-cover bg-center"
        style={{ backgroundImage: `url(${BACKGROUND_URL})` }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[linear-gradient(100deg,rgba(16,43,76,0.84)_0%,rgba(16,43,76,0.66)_50%,rgba(16,43,76,0.42)_100%)]"
      />

      <div className="flex flex-1 flex-col px-8 pt-7 xl:px-16 xl:pt-9 2xl:px-24 2xl:pt-12">
        <header className="flex items-start justify-between gap-4">
          <LoginBrand tone="light" />
          <span className="inline-flex items-center gap-2.5 rounded-full border border-white/15 bg-[#102B4C]/60 px-5 py-2.5 text-[15px] font-medium text-white/90 backdrop-blur-sm">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-[#10C99A]" />
            Solution ERP
          </span>
        </header>

        <div className="mt-6 max-w-[34rem] xl:mt-10">
          <h1 className="font-serif text-[34px] leading-[1.08] font-bold tracking-tight text-white xl:text-[44px] 2xl:text-[50px]">
            Gérez toute votre entreprise{" "}
            <span className="text-[#10C99A]">au même endroit.</span>
          </h1>
          <p className="mt-4 max-w-[32rem] text-[15px] leading-6 text-white/85 xl:mt-5 xl:text-lg xl:leading-8">
            Une plateforme complète pour piloter vos ventes, achats, stocks, clients,
            fournisseurs et la performance de votre activité.
          </p>
        </div>

        <ul className="relative z-10 mt-5 grid max-w-[40rem] grid-cols-2 gap-3 xl:mt-8 xl:gap-4">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <li
                key={feature.title}
                className="group flex items-center gap-3 rounded-2xl border border-white/10 bg-[#102B4C]/60 px-3 py-3 backdrop-blur-sm transition duration-300 hover:-translate-y-0.5 hover:border-white/25 hover:bg-[#102B4C]/75 motion-reduce:transition-none motion-reduce:hover:translate-y-0 xl:gap-4 xl:px-4 xl:py-4"
              >
                <span
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white shadow-[0_8px_18px_rgba(0,0,0,0.25)] xl:h-14 xl:w-14 ${feature.iconClass}`}
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

        {/* Counter photo: fills the free space under the cards, runs behind the
            bottom bar and fades into the panel at its top edge. */}
        <div className="relative -z-10 mt-auto min-h-[8rem] flex-1 [@media(max-height:849px)]:hidden">
          <div
            aria-hidden="true"
            className="absolute inset-x-[-2rem] top-0 -bottom-3 bg-cover bg-bottom xl:inset-x-[-4rem] 2xl:inset-x-[-6rem] [mask-image:linear-gradient(to_bottom,transparent_0%,black_30%)]"
            style={{ backgroundImage: `url(${COUNTER_PHOTO})` }}
          />
        </div>
      </div>

      <footer className="relative mx-5 mb-5 rounded-2xl border border-white/10 bg-[#102B4C]/70 px-4 py-3 backdrop-blur-md xl:mx-10 xl:px-6 xl:py-4 2xl:mx-16">
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
                  <span className="block font-serif text-[15px] font-semibold text-white xl:whitespace-nowrap">
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
