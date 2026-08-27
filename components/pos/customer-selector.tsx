import { User } from "lucide-react";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CustomerDto } from "@/types/operations-dto";

type CustomerSelectorProps = {
  customers: CustomerDto[];
  customerId: string;
  onChange: (customerId: string) => void;
};

export function CustomerSelector({
  customers,
  customerId,
  onChange,
}: CustomerSelectorProps) {
  const selected = customers.find((customer) => customer.id === customerId);

  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <User aria-hidden="true" className="h-3.5 w-3.5" />
        Client
      </Label>
      <Select value={customerId} onValueChange={(value) => value && onChange(value)}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Sélectionner un client">
            {() => selected?.name ?? "Sélectionner un client"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {customers.map((customer) => (
            <SelectItem key={customer.id} value={customer.id}>
              {customer.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
