import { cn } from "@/lib/utils";
import { PageEyebrow } from "@/components/ui/page-eyebrow";

type AppPageHeaderProps = {
  /** Omit eyebrow + title when the page title is already in the fixed top
   *  header (components/layout/header.tsx): only the actions are rendered. */
  eyebrow?: string;
  title?: string;
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
  // Actions only (the page title lives in the fixed header): right-aligned row.
  if (!title) {
    if (!actions && !description) return null;
    return (
      <div className={cn("flex flex-col gap-3 md:flex-row md:items-center md:justify-between", className)}>
        {description ? (
          <p className="text-sm text-[var(--text-secondary)]">{description}</p>
        ) : (
          <span aria-hidden="true" />
        )}
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-5 md:flex-row md:items-end md:justify-between",
        className,
      )}
    >
      <div className="max-w-3xl">
        {eyebrow ? <PageEyebrow>{eyebrow}</PageEyebrow> : null}
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
