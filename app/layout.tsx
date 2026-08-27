import type { Metadata } from "next";
import "./globals.css";

import { AuthProvider } from "@/hooks/use-auth";

export const metadata: Metadata = {
  title: "COMDIS",
  description: "COMDIS Manager - gestion du stock, des ventes, des chauffeurs et de la comptabilite.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" className="h-full antialiased">
      <body className="min-h-full bg-background text-foreground">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
