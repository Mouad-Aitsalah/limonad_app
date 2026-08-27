import { cn } from "@/lib/utils";
import { PageEyebrow } from "@/components/ui/page-eyebrow";

type AppPageHeaderProps = {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
};

export function AppPageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: AppPageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-5 md:flex-row md:items-end md:justify-between",
        className,
      )}
    >
      <div className="max-w-3xl">
        <PageEyebrow>{eyebrow}</PageEyebrow>
        <h1 className="mt-3 font-heading text-[2.1rem] font-semibold tracking-[-0.05em] text-[var(--text-primary)] sm:text-[2.7rem]">
          {title}
        </h1>
        {description ? (
          <p className="mt-3 text-sm leading-7 text-[var(--text-secondary)] sm:text-base">
            {description}
          </p>
        ) : null}
      </div>

      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}
