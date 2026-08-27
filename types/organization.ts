export type OrganizationStatus = "ACTIVE" | "INACTIVE";

export type OrganizationAdminDto = {
  id: string;
  fullName: string;
  email: string;
  status: "ACTIVE" | "INACTIVE" | "BLOCKED";
};

export type OrganizationStatsDto = {
  usersCount: number;
  adminsCount: number;
  cashiersCount: number;
  driversCount: number;
  productsCount: number;
  customersCount: number;
  salesCount: number;
  purchasesCount: number;
};

export type OrganizationSummaryDto = {
  id: string;
  code: string;
  name: string;
  tradeName: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  status: OrganizationStatus;
  admin: OrganizationAdminDto | null;
  stats: OrganizationStatsDto;
  createdAt: string;
  updatedAt: string;
};

export type OrganizationDetailDto = OrganizationSummaryDto & {
  users: Array<{
    id: string;
    fullName: string;
    email: string;
    role: "ADMIN" | "DEPOT_MANAGER" | "CASHIER" | "DRIVER" | "SUPER_ADMIN";
    status: "ACTIVE" | "INACTIVE" | "BLOCKED";
    createdAt: string;
  }>;
};

export type OrganizationMutationInput = {
  name: string;
  code: string;
  tradeName?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
  status?: OrganizationStatus;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
};

export type OrganizationUpdateInput = {
  name: string;
  code: string;
  tradeName?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
  status?: OrganizationStatus;
};
