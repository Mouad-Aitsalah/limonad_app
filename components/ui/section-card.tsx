import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

type SectionCardProps = {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
};

export function SectionCard({
  title,
  description,
  action,
  children,
  className,
  contentClassName,
}: SectionCardProps) {
  return (
    <Card className={cn("table-shell", className)}>
      {title || description || action ? (
        <CardHeader>
          <div>
            {title ? <CardTitle>{title}</CardTitle> : null}
            {description ? <CardDescription>{description}</CardDescription> : null}
          </div>
          {action ? <CardAction>{action}</CardAction> : null}
        </CardHeader>
      ) : null}
      <CardContent className={contentClassName}>{children}</CardContent>
    </Card>
  );
}
