import { cn } from "@/lib/utils";

type PageEyebrowProps = {
  children: React.ReactNode;
  className?: string;
};

export function PageEyebrow({ children, className }: PageEyebrowProps) {
  return <p className={cn("page-eyebrow", className)}>{children}</p>;
}
