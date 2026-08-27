import type { Metadata } from "next";

import { DriverRuntimeShell } from "@/components/driver/driver-runtime-shell";

export const metadata: Metadata = {
  title: {
    template: "%s | COMDIS Chauffeur",
    default: "COMDIS Chauffeur",
  },
};

export default function DriverLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <DriverRuntimeShell>{children}</DriverRuntimeShell>;
}
