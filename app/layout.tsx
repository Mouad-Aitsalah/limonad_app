import type { Metadata, Viewport } from "next";
import "./globals.css";

import { AuthProvider } from "@/hooks/use-auth";
import { DriverRuntimeBoundary } from "@/components/driver/driver-runtime-boundary";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

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
        <AuthProvider>
          <DriverRuntimeBoundary>{children}</DriverRuntimeBoundary>
        </AuthProvider>
      </body>
    </html>
  );
}
