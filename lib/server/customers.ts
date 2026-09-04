import "server-only";

import { z } from "zod";

import { CUSTOMER_ACCOUNT_PREFIX, formatCustomerCode, resolveCustomerCodeFromInput } from "@/lib/customer-code";
import { MONEY_RANGE_MAX_NUMBER } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { assertMoneyRange, OperationsServiceError } from "@/lib/server/depots";
import { DocumentType, reserveDocumentSequence } from "@/lib/server/document-sequence";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { CustomerDto, CustomerMutationInput } from "@/types/operations-dto";

const customerTypes = [
  "GROCERY",
  "CAFE",
  "RESTAURANT",
  "SUPERMARKET",
  "WHOLESALER",
  "COUNTER",
  "OTHER",
] as const;

const customerStatuses = ["ACTIVE", "INACTIVE", "BLOCKED"] as const;
const customerAccountPrefix = CUSTOMER_ACCOUNT_PREFIX;

export const customerMutationSchema = z.object({
  code: optionalString(),
  name: z.string().trim().min(1, "Le nom est obligatoire."),
  phone: z.string().trim().nullable().optional().transform(normalizePhone),
  email: z
    .string()
    .trim()
    .email("L'adresse email est invalide.")
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  address: z.string().trim().min(1, "L'adresse est obligatoire."),
  city: z.string().trim().min(1, "La ville est obligatoire."),
  type: z.enum(customerTypes, { error: "Le type est obligatoire." }),
  status: z.enum(customerStatuses).optional(),
  // F8-F: input-level sanity bound only, not the real protection - see the
  // server-side assertMoneyRange call in parseCustomerInput below.
  creditLimit: z.coerce
    .number()
    .min(0, "Le plafond de credit ne peut pas etre negatif.")
    .max(MONEY_RANGE_MAX_NUMBER, "Le plafond de credit depasse la limite autorisee.")
    .optional(),
  ice: optionalString(),
  taxId: optionalString(),
  contactName: optionalString(),
  // Never trust the frontend alone: a coordinate outside these ranges is
  // physically impossible and rejected here regardless of what produced it
  // (manual entry, a corrupted capture, or a forged request).
  latitude: z.coerce
    .number()
    .min(-90, "La latitude doit etre comprise entre -90 et 90.")
    .max(90, "La latitude doit etre comprise entre -90 et 90.")
    .nullable()
    .optional(),
  longitude: z.coerce
    .number()
    .min(-180, "La longitude doit etre comprise entre -180 et 180.")
    .max(180, "La longitude doit etre comprise entre -180 et 180.")
    .nullable()
    .optional(),
  locationAccuracy: z.coerce.number().min(0).nullable().optional(),
  notes: optionalString(),
});

type CustomerRecord = Awaited<ReturnType<typeof getCustomerRecordById>>;

export function mapCustomerToDto(customer: NonNullable<CustomerRecord>): CustomerDto {
  return {
    id: customer.id,
    code: customer.code,
    displayCode: formatCustomerCode(customer.code),
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    address: customer.address,
    city: customer.city,
    type: customer.type,
    status: customer.status,
    creditLimit: customer.creditLimit.toNumber(),
    currentBalance: customer.currentBalance.toNumber(),
    ice: customer.ice,
    taxId: customer.taxId,
    contactName: customer.contactName,
    latitude: customer.latitude?.toNumber() ?? null,
    longitude: customer.longitude?.toNumber() ?? null,
    locationAccuracy: customer.locationAccuracy?.toNumber() ?? null,
    locationUpdatedAt: customer.locationUpdatedAt?.toISOString() ?? null,
    notes: customer.notes,
    createdByUserId: customer.createdByUserId,
    createdByUserName: customer.createdBy.fullName,
    createdByDriverId: customer.createdByDriverId,
    createdFromTruckId: customer.createdFromTruckId,
    creationOrigin: customer.creationOrigin,
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString(),
  };
}

export async function getCustomers(): Promise<CustomerDto[]> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const customers = await prisma.customer.findMany({
    where: { organizationId: currentUser.organizationId },
    include: customerInclude,
    orderBy: { name: "asc" },
  });
  return customers.map(mapCustomerToDto);
}

const CUSTOMER_SEARCH_DEFAULT_LIMIT = 20;
const CUSTOMER_SEARCH_MAX_LIMIT = 50;

/**
 * Phase 3: dedicated fast-path customer search - GET /api/customers/search.
 * getCustomers() above stays unbounded and untouched (still needed by
 * avoirs' full-list picker and the POS contexts' small initial preload -
 * see getCounterPosContext/getDriverPosContext), but nothing should ever
 * search a fully-preloaded list again the way the old POS customer
 * <select> did.
 *
 * A driver session is transparently scoped to the same "ADMIN-origin OR
 * created by this driver" restriction getCustomersForCurrentDriver()
 * already enforces (lib/server/driver-customers.ts) - one endpoint for
 * both POS contexts, never a way for a driver to search another driver's
 * privately-created customers. An exact code match is checked first (a
 * scanned/typed customer code should never be shadowed by a partial name
 * match), then name/code/phone/email substring search.
 */
export async function searchCustomers(params: {
  q: string;
  limit?: number;
  activeOnly?: boolean;
}): Promise<CustomerDto[]> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier", "driver"]);
  const organizationId = currentUser.organizationId;
  const query = params.q.trim();
  if (!query) return [];

  const requestedLimit = Math.trunc(params.limit ?? CUSTOMER_SEARCH_DEFAULT_LIMIT);
  const limit =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, CUSTOMER_SEARCH_MAX_LIMIT)
      : CUSTOMER_SEARCH_DEFAULT_LIMIT;
  const activeFilter = params.activeOnly !== false ? { status: "ACTIVE" as const } : {};
  const driverScope =
    currentUser.role === "driver"
      ? { OR: [{ creationOrigin: "ADMIN" as const }, { createdByDriverId: currentUser.driverId ?? "__never__" }] }
      : {};

  const exactCodeMatch = await prisma.customer.findFirst({
    where: { organizationId, code: query, ...activeFilter, ...driverScope },
    include: customerInclude,
  });
  if (exactCodeMatch) {
    return [mapCustomerToDto(exactCodeMatch)];
  }

  const matches = await prisma.customer.findMany({
    where: {
      organizationId,
      ...activeFilter,
      // AND (not a second top-level `OR`, which would silently overwrite
      // driverScope's own OR below it in the same object) - a driver must
      // never search outside their allowed customers just because the text
      // search also needs an OR across name/code/phone/email.
      AND: [
        driverScope,
        {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { code: { contains: query, mode: "insensitive" } },
            { phone: { contains: query, mode: "insensitive" } },
            { email: { contains: query, mode: "insensitive" } },
          ],
        },
      ],
    },
    include: customerInclude,
    orderBy: { name: "asc" },
    take: limit,
  });

  return matches.map(mapCustomerToDto);
}

/**
 * POS "N° client" box: turns a short number (1, 15, 125), a full "3421/15"
 * or a raw "342115" into the one customer it can only be, scoped to the
 * caller's organisation (and, for a driver session, to the same
 * "ADMIN-origin OR created by this driver" restriction searchCustomers
 * already enforces). Returns null when the input can't be a customer number
 * or no such customer exists in this organisation - the caller turns that
 * into a clean "Client introuvable", never a 500. The same number in
 * another organisation is unreachable: the lookup is always
 * `where: { organizationId, code }`.
 */
export async function resolveCustomerByNumber(rawInput: string): Promise<CustomerDto | null> {
  const currentUser = await requireOrganizationUser([
    "admin",
    "depot_manager",
    "cashier",
    "driver",
  ]);
  const input = rawInput.trim();
  const legacyCode = resolveCustomerCodeFromInput(input);
  if (!input && !legacyCode) return null;

  const driverScope =
    currentUser.role === "driver"
      ? {
          OR: [
            { creationOrigin: "ADMIN" as const },
            { createdByDriverId: currentUser.driverId ?? "__never__" },
          ],
        }
      : {};

  const customer = await prisma.customer.findFirst({
    where: {
      organizationId: currentUser.organizationId,
      code: {
        in: [...new Set([input, legacyCode].filter((value): value is string => Boolean(value)))],
      },
      ...driverScope,
    },
    include: customerInclude,
  });
  return customer ? mapCustomerToDto(customer) : null;
}

const POS_CUSTOMER_PRELOAD_LIMIT = 20;

/**
 * Phase 3: bounded customer preload for POS contexts (getCounterPosContext,
 * getDriverPosContext) - replaces preloading every customer in the
 * organization. Always includes:
 *   - up to POS_CUSTOMER_PRELOAD_LIMIT most-recently-created customers, as a
 *     small, useful starting set for the combobox before the cashier/driver
 *     types anything;
 *   - any `guaranteeType` customer (e.g. the org's "COUNTER"/walk-in
 *     customer, which the counter POS pre-selects by default) even if it
 *     falls outside that recency window;
 *   - `guaranteeCustomerId`, when given, even if outside both of the above -
 *     e.g. a customer targeted via a driver tour-visit deep link
 *     (?customerId=...) must resolve correctly regardless of how old they
 *     are.
 * Anything beyond this small set is reached via searchCustomers(), never by
 * preloading more.
 */
export async function getPosCustomerPreload(params: {
  organizationId: string;
  extraWhere?: Prisma.CustomerWhereInput;
  guaranteeType?: "COUNTER";
  guaranteeCustomerId?: string | null;
}): Promise<CustomerDto[]> {
  const { organizationId, extraWhere = {}, guaranteeType, guaranteeCustomerId } = params;

  const recentPromise = prisma.customer.findMany({
    where: { organizationId, status: "ACTIVE", ...extraWhere },
    include: customerInclude,
    orderBy: { createdAt: "desc" },
    take: POS_CUSTOMER_PRELOAD_LIMIT,
  });
  const guaranteeTypePromise = guaranteeType
    ? prisma.customer.findMany({
        where: { organizationId, type: guaranteeType, status: "ACTIVE", ...extraWhere },
        include: customerInclude,
        orderBy: { name: "asc" },
        take: 5,
      })
    : Promise.resolve([]);
  const guaranteeIdPromise = guaranteeCustomerId
    ? prisma.customer.findMany({
        where: { organizationId, id: guaranteeCustomerId, ...extraWhere },
        include: customerInclude,
        take: 1,
      })
    : Promise.resolve([]);

  const [recent, guaranteedByType, guaranteedById] = await Promise.all([
    recentPromise,
    guaranteeTypePromise,
    guaranteeIdPromise,
  ]);

  const byId = new Map<string, NonNullable<CustomerRecord>>();
  for (const list of [guaranteedById, guaranteedByType, recent]) {
    for (const customer of list) {
      if (!byId.has(customer.id)) byId.set(customer.id, customer);
    }
  }
  return Array.from(byId.values()).map(mapCustomerToDto);
}

export async function getCustomerById(id: string): Promise<CustomerDto> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const customer = await getCustomerRecordById(id, currentUser.organizationId);
  if (!customer) throw new OperationsServiceError("Client introuvable.", 404);
  return mapCustomerToDto(customer);
}

export async function createCustomer(input: CustomerMutationInput): Promise<CustomerDto> {
  const user = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const data = await parseCustomerInput(input);
  const { code, ...customerData } = data;
  await ensureUniquePhone(user.organizationId, data.phone);
  await ensureUniqueCustomerCode(user.organizationId, data.code);

  // F10: read-then-write (nextCustomerCode counts existing rows when no
  // explicit code is given) - a retry after a Serializable conflict
  // (P2034) or a numbering/code race (P2002) simply recomputes a fresh
  // code and creates one correct row, never a duplicate customer.
  const customer = await withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
        return tx.customer.create({
          data: {
            organizationId: user.organizationId,
            ...customerData,
            locationUpdatedAt: resolveLocationUpdatedAt(customerData.latitude, customerData.longitude),
            code: code ?? (await nextCustomerCode(tx, user.organizationId)),
            status: customerData.status ?? "ACTIVE",
            creditLimit: customerData.creditLimit ?? 0,
            currentBalance: 0,
            createdByUserId: user.id,
            creationOrigin: "ADMIN",
          },
          include: customerInclude,
        });
      },
      { isolationLevel: "Serializable" },
    ),
  );
  return mapCustomerToDto(customer);
}

export async function updateCustomer(
  id: string,
  input: CustomerMutationInput,
): Promise<CustomerDto> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const existing = await getCustomerRecordById(id, currentUser.organizationId);
  if (!existing) {
    throw new OperationsServiceError("Client introuvable.", 404);
  }
  const data = await parseCustomerInput(input);
  const { code, ...customerData } = data;
  await ensureUniquePhone(currentUser.organizationId, data.phone, id);
  await ensureUniqueCustomerCode(currentUser.organizationId, data.code, id);

  const customer = await prisma.customer.update({
    where: { id },
    data: {
      ...customerData,
      locationUpdatedAt: resolveLocationUpdatedAt(customerData.latitude, customerData.longitude),
      ...(code ? { code } : {}),
      creditLimit: customerData.creditLimit ?? 0,
      status: customerData.status ?? "ACTIVE",
    },
    include: customerInclude,
  });
  return mapCustomerToDto(customer);
}

export async function setCustomerStatus(
  id: string,
  status: string,
): Promise<CustomerDto> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager"]);
  if (!customerStatuses.includes(status as (typeof customerStatuses)[number])) {
    throw new OperationsServiceError("Statut invalide.", 422);
  }
  const existing = await getCustomerRecordById(id, currentUser.organizationId);
  if (!existing) {
    throw new OperationsServiceError("Client introuvable.", 404);
  }
  const customer = await prisma.customer.update({
    where: { id },
    data: { status: status as (typeof customerStatuses)[number] },
    include: customerInclude,
  });
  return mapCustomerToDto(customer);
}

/**
 * locationUpdatedAt is always server-derived, never client-supplied: it
 * marks "a valid latitude/longitude pair was submitted just now", distinct
 * from the generic updatedAt column which bumps on every field edit (e.g.
 * a phone number correction), not just a location change.
 */
export function resolveLocationUpdatedAt(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): Date | null {
  return latitude != null && longitude != null ? new Date() : null;
}

export async function parseCustomerInput(input: CustomerMutationInput) {
  const parsed = customerMutationSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationsServiceError(
      "Certains champs sont invalides.",
      422,
      Object.fromEntries(
        parsed.error.issues.map((issue) => [
          issue.path.join(".") || "form",
          issue.message,
        ]),
      ),
    );
  }
  // F8-F: server-side gate, kept independent of the Zod .max() above - this
  // is the single choke point both createCustomer and updateCustomer funnel
  // through. currentBalance itself is never client-supplied here (always 0
  // at creation, never touched at update - it only ever changes via a
  // sale's payment.creditAmount, already checked in F8-D).
  if (parsed.data.creditLimit !== undefined) {
    assertMoneyRange(parsed.data.creditLimit, "creditLimit");
  }
  return parsed.data;
}

export async function ensureUniqueCustomerCode(
  organizationId: string,
  code?: string | null,
  currentCustomerId?: string,
) {
  if (!code) return;
  const owner = await prisma.customer.findFirst({
    where: {
      code,
      organizationId,
      ...(currentCustomerId ? { id: { not: currentCustomerId } } : {}),
    },
    select: { id: true },
  });
  if (owner) {
    throw new OperationsServiceError("Un client existe deja avec ce code.", 409, {
      code: "Un client existe deja avec ce code.",
    });
  }
}

export function normalizePhone(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

export async function ensureUniquePhone(
  organizationId: string,
  phone: string | null,
  currentCustomerId?: string,
) {
  if (!phone) return;
  const owner = await prisma.customer.findFirst({
    where: {
      phone,
      organizationId,
      ...(currentCustomerId ? { id: { not: currentCustomerId } } : {}),
    },
    select: { id: true },
  });
  if (owner) {
    throw new OperationsServiceError("Un client existe deja avec ce telephone.", 409, {
      phone: "Un client existe deja avec ce telephone.",
    });
  }
}

export async function nextCustomerCode(
  tx: Pick<typeof prisma, "customer" | "$queryRaw">,
  organizationId: string,
) {
  const number = await reserveDocumentSequence(
    tx,
    organizationId,
    DocumentType.CustomerCode,
  );
  return `${customerAccountPrefix}${number}`;
}

function optionalString() {
  return z
    .string()
    .trim()
    .transform((value) => (value.length > 0 ? value : null))
    .nullable()
    .optional();
}

// F10: same shape as every other file's local withSerializableRetry in
// this codebase (counter-sales.ts, credit-notes.ts, tours.ts, etc.).
// Exported so driver-customers.ts - which already imports several helpers
// from this file (ensureUniquePhone, parseCustomerInput, ...) - can reuse
// it for its own customer-create transaction instead of duplicating the
// same wrapper a second time.
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withSerializableRetry<T>(operation: () => Promise<T>, maxAttempts = 40): Promise<T> {
  let attempt = 0;

  while (attempt < maxAttempts) {
    try {
      return await operation();
    } catch (error) {
        const prismaError = error as { code?: string; message?: string };
      attempt += 1;
      const isRetryable =
        ["P2002", "P2034"].includes(prismaError.code ?? "") ||
        (prismaError.code === "P2010" &&
          /40001|40P01/.test(prismaError.message ?? ""));
      if (!isRetryable || attempt >= maxAttempts) {
        throw error;
      }
      // Jittered backoff: under N-way true-simultaneous contention on the
      // same counter row, retrying instantly just re-collides with the same
      // herd (empirically verified: without this, 50-100-way concurrent
      // reserveDocumentSequence() calls exhausted immediate retries - see
      // scripts/_tmp-test-real-generators.ts in the Phase 3 numbering
      // chantier report).
      await sleep(Math.min(800, 10 * 1.5 ** attempt) * (0.5 + Math.random()));
    }
  }

  throw new OperationsServiceError("Impossible d'enregistrer le client.", 500);
}

const customerInclude = {
  createdBy: { select: { fullName: true } },
} as const;

async function getCustomerRecordById(id: string, organizationId: string) {
  return prisma.customer.findFirst({
    where: { id, organizationId },
    include: customerInclude,
  });
}
