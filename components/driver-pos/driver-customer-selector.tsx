import { User } from "lucide-react";

import { Label } from "@/components/ui/label";
import { useCustomersStore } from "@/hooks/use-customers-store";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type DriverCustomerSelectorProps = {
  customerId: string;
  onChange: (customerId: string) => void;
};

export function DriverCustomerSelector({
  customerId,
  onChange,
}: DriverCustomerSelectorProps) {
  const customers = useCustomersStore();
  const selected = customers.find((customer) => customer.id === customerId);

  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <User aria-hidden="true" className="h-3.5 w-3.5" />
        Client
      </Label>
      <Select value={customerId} onValueChange={(value) => value && onChange(value)}>
        <SelectTrigger className="h-11 w-full">
          <SelectValue placeholder="Selectionner un client">
            {() => selected?.nom ?? "Selectionner un client"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {customers.map((customer) => (
            <SelectItem key={customer.id} value={customer.id}>
              {customer.nom}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
