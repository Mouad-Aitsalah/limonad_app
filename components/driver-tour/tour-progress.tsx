import { cn } from "@/lib/utils";

export function TourProgress({
  completed,
  total,
}: {
  completed: number;
  total: number;
}) {
  if (total <= 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Progression</span>
        <span>
          {completed} sur {total}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        {Array.from({ length: total }).map((_, index) => {
          const done = index < completed;
          return (
            <span
              key={index}
              className={cn(
                "h-2.5 flex-1 rounded-full transition-colors",
                done ? "bg-emerald-500" : "bg-slate-200",
              )}
            />
          );
        })}
      </div>
    </div>
  );
}
