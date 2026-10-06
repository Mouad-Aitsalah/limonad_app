import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { AuthProvider } from "@/hooks/use-auth";
import { DriverRuntimeBoundary } from "@/components/driver/driver-runtime-boundary";

// Geist and Geist Mono, self-hosted by next/font (the files are fetched once at
// build time and served from this domain - the browser never calls Google). They
// define the --font-geist-sans / --font-geist-mono variables app/globals.css builds
// on (body, --font-sans, --font-heading, --font-mono): without them every page fell
// back to the browser's default serif (Times New Roman).
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Only the assistant's code blocks use the mono font: not preloaded on every page.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  preload: false,
});

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
    <html lang="fr" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-background text-foreground">
        <AuthProvider>
          <DriverRuntimeBoundary>{children}</DriverRuntimeBoundary>
        </AuthProvider>
      </body>
    </html>
  );
}
