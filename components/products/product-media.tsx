import Image from "next/image";
import { Package2 } from "lucide-react";

import { cn } from "@/lib/utils";

const passthroughImageLoader = ({ src }: { src: string }) => src;

type ProductMediaProps = {
  imageUrl?: string | null;
  alt: string;
  className?: string;
  imageClassName?: string;
  placeholderClassName?: string;
  iconClassName?: string;
  fit?: "contain" | "cover";
  sizes?: string;
};

export function ProductMedia({
  imageUrl,
  alt,
  className,
  imageClassName,
  placeholderClassName,
  iconClassName,
  fit = "contain",
  sizes = "(max-width: 640px) 50vw, (max-width: 1280px) 33vw, 25vw",
}: ProductMediaProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[20px] border border-border/70 bg-[radial-gradient(circle_at_top,#d1fae5,transparent_58%),linear-gradient(135deg,#f0fdf4_0%,#dcfce7_100%)]",
        className,
      )}
    >
      {imageUrl ? (
        <Image
          loader={passthroughImageLoader}
          unoptimized
          src={imageUrl}
          alt={alt}
          fill
          sizes={sizes}
          className={cn(
            fit === "cover" ? "object-cover" : "object-contain p-3",
            imageClassName,
          )}
        />
      ) : (
        <div
          className={cn(
            "flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,#d1fae5,transparent_58%),linear-gradient(135deg,#ecfdf5_0%,#d1fae5_100%)] text-emerald-700",
            placeholderClassName,
          )}
        >
          <Package2 className={cn("h-8 w-8", iconClassName)} />
        </div>
      )}
    </div>
  );
}
