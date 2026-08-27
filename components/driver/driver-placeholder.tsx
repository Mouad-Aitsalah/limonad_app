import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

type DriverPlaceholderProps = {
  title: string;
  description: string;
  icon: LucideIcon;
};

export function DriverPlaceholder({
  title,
  description,
  icon: Icon,
}: DriverPlaceholderProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          {title}
        </h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <Icon aria-hidden="true" className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            Cet écran sera disponible avec le module correspondant.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
