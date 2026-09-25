import type { MetadataRoute } from "next";

// PWA installable uniquement (Phase 1) : ce manifest ne déclare ni service
// worker ni stratégie de cache, donc aucune page authentifiée ni réponse API
// n'est mise en cache. Servi sur /manifest.webmanifest (chemin avec extension,
// donc non intercepté par proxy.ts).
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "COMDIS Manager",
    short_name: "COMDIS",
    description:
      "COMDIS Manager - gestion du stock, des ventes, des chauffeurs et de la comptabilite.",
    lang: "fr",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "any",
    theme_color: "#0f7a5d",
    background_color: "#eef4f9",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
