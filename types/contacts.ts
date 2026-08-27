export type ContactStatus = "ACTIVE" | "INACTIVE";

export type ContactDto = {
  id: string;
  reference: string;
  fullName: string;
  supplierId: string | null;
  supplierCode: string | null;
  supplierName: string | null;
  phone1: string | null;
  phone2: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  status: ContactStatus;
  createdAt: string;
  updatedAt: string;
};

export type ContactsSummaryDto = {
  totalCount: number;
  activeCount: number;
  linkedToSupplierCount: number;
  withoutPhoneCount: number;
};

export type ContactsPayload = {
  items: ContactDto[];
  summary: ContactsSummaryDto;
};

export type ContactInput = {
  reference: string;
  fullName: string;
  supplierId?: string | null;
  phone1?: string | null;
  phone2?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  status?: ContactStatus;
};
