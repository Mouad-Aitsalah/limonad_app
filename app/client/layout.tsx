import { Toaster } from "@/components/ui/sonner";

/** Espace Client shell: separate from the staff dashboard (no ERP navigation). */
export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Toaster position="top-right" />
    </>
  );
}
