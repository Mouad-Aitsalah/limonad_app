"use client";

import { MobileSupplierPicker } from "@/components/pos/mobile-supplier-picker";
import { SupplierFilter, type SupplierOption } from "@/components/pos/supplier-filter";

type LoadingSupplierSelectProps = {
  suppliers: SupplierOption[];
  /** Selected supplier, or null for "Tous les fournisseurs". */
  value: SupplierOption | null;
  onChange: (supplier: SupplierOption | null) => void;
};

/**
 * Supplier selector of the Transfert de Stock screen: the very same two POS
 * components, one per breakpoint - the full-screen searchable sheet on phones
 * (MobileSupplierPicker, as in the mobile POS) and the searchable combobox
 * from lg up (SupplierFilter). Both offer "Tous les fournisseurs" first, then
 * the suppliers, with a text search by name.
 */
export function LoadingSupplierSelect({ suppliers, value, onChange }: LoadingSupplierSelectProps) {
  return (
    <>
      <MobileSupplierPicker
        className="lg:hidden [&>button]:h-11"
        suppliers={suppliers}
        value={value}
        onChange={onChange}
      />
      <SupplierFilter className="max-lg:hidden" suppliers={suppliers} value={value} onChange={onChange} />
    </>
  );
}
