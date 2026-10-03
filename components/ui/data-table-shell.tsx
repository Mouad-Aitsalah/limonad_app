import { cn } from "@/lib/utils";
import { SectionCard } from "@/components/ui/section-card";

type DataTableShellProps = {
  title?: string;
  description?: string;
  countLabel?: string;
  toolbar?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Opt-in: below lg the content drops its bordered white frame (it is a list of
   *  cards there). Other callers keep the frame at every size. */
  frameless?: "below-lg";
};

export function DataTableShell({
  title,
  description,
  countLabel,
  toolbar,
  action,
  children,
  className,
  frameless,
}: DataTableShellProps) {
  return (
    <SectionCard
      title={title}
      description={description}
      action={action}
      className={className}
      contentClassName="space-y-5"
    >
      {toolbar}
      {countLabel ? <p className="text-sm text-[var(--text-secondary)]">{countLabel}</p> : null}
      <div
        className={cn(
          "overflow-hidden rounded-[22px] border border-border/70 bg-white/82",
          frameless === "below-lg" &&
            "max-lg:overflow-visible max-lg:rounded-none max-lg:border-0 max-lg:bg-transparent",
        )}
      >
        {children}
      </div>
    </SectionCard>
  );
}
