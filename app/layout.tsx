import type { Metadata, Viewport } from "next";
import "./globals.css";

import { AuthProvider } from "@/hooks/use-auth";
import { DriverRuntimeBoundary } from "@/components/driver/driver-runtime-boundary";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0f7a5d",
};

export const metadata: Metadata = {
  title: "COMDIS",
  description: "COMDIS Manager - gestion du stock, des ventes, des chauffeurs et de la comptabilite.",
  applicationName: "COMDIS Manager",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "COMDIS",
    statusBarStyle: "default",
  },
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
