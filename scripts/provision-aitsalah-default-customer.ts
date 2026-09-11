/**
 * One-time, idempotent data provisioning: creates the "Autre" customer used
 * as the POS's default counter customer for AITSALAH STORE, AND its
 * matching auxiliary AccountingAccount, in one controlled operation.
 *
 * The organization is never a hardcoded id: it is resolved by its stable
 * business code, Organization.code = "COMDIS-PRINCIPAL" (see
 * AITSALAH_STORE_ORGANIZATION_CODE below) - the same code
 * lib/server/counter-sales.ts#getCounterPosContext checks server-side
 * before ever proposing "Autre" as the POS default, so the two stay in
 * lockstep without either one baking in an environment-specific row id.
 * If zero or more than one organization matches that code, this STOPS
 * with a clear message rather than guessing (see resolveTargetOrganization).
 *
 * Idempotent and conflict-aware on every re-run (including later against
 * Production, after an explicit "feu vert" per the project's standing
 * rule):
 *  - Customer "Autre" already exists, its auxiliary account already exists
 *    correctly (same code, name "Autre") -> no-op, just reports it.
 *  - Customer "Autre" already exists, its auxiliary account is missing ->
 *    create ONLY the account (Customer is never touched again).
 *  - Customer "Autre" already exists, an account already sits on that code
 *    under a DIFFERENT name (i.e. an unrelated account, like the
 *    "Boisson divers" collision this script's prior run once hit) -> STOP,
 *    report the conflict precisely, touch nothing. Never rename someone
 *    else's account.
 *  - Customer "Autre" does not exist -> reserve a free code (checked
 *    against BOTH Customer.code and AccountingAccount.code - see
 *    nextFreeCustomerCode below), then create the Customer AND its
 *    auxiliary account together, in the SAME transaction, so there is no
 *    partial state (Customer created, account missing) even if the
 *    process crashes or a Production maintenance connection blip trips
 *    Prisma's interactive-transaction timeout.
 *
 * Never touches any other customer (in particular, code "34211" / "N° 1",
 * already used by "mouad ait salah", is never renamed or reused).
 *
 * The account number is never invented: it comes from the exact same
 * atomic DocumentSequence counter + occupied-code guard
 * lib/server/customers.ts#nextCustomerCode uses for every real "new
 * customer" created through the app (prefix "3421" + the next value of the
 * (organizationId, "CUSTOMER_CODE", "") counter row, skipped forward past
 * any code already taken by a Customer OR an AccountingAccount in this
 * org - see that function's own doc comment for the full collision
 * history and the precise concurrency guarantee this does and does not
 * provide). The auxiliary-account creation mirrors
 * lib/server/accounting.ts#ensureAccountingAccountByCode /
 * resolveCustomerAuxiliaryCode exactly (same normalization, same
 * "code already 3421+digits -> unchanged" rule, same fields). Both are
 * reimplemented inline (never imported) only because this codebase's
 * scripts/*.ts convention is a standalone PrismaClient run by plain
 * `tsx`, and lib/server/*.ts carries `import "server-only"` - a package
 * this repository does not even install as a real dependency (Next.js
 * resolves it internally, only inside its own bundler); importing from
 * lib/server/* here would fail to even resolve, not just violate a style
 * convention. See any scripts/backfill-*.ts for the same established
 * pattern. The SQL is copied verbatim from
 * lib/server/document-sequence.ts#reserveDocumentSequence.
 *
 * Everything else mirrors lib/server/customers.ts#createCustomer's own
 * defaults exactly (status ACTIVE, creditLimit 0, creditLimitEnabled false,
 * currentBalance 0, creationOrigin "ADMIN") - no invented business fields.
 */
import { loadEnvConfig } from "@next/env";
import { PrismaPg } from "@prisma/adapter-pg";

import { Prisma, PrismaClient } from "../lib/generated/prisma/client";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const AITSALAH_STORE_ORGANIZATION_CODE = "COMDIS-PRINCIPAL";
const DEFAULT_POS_CUSTOMER_NAME = "Autre";
const CUSTOMER_CODE_DOCUMENT_TYPE = "CUSTOMER_CODE";
const CUSTOMER_ACCOUNT_PREFIX = "3421";
const MAX_CODE_ATTEMPTS = 10_000;
const AUXILIARY_ACCOUNT_TYPE = "RECEIVABLE";

// Verbatim copy of lib/server/document-sequence.ts#reserveDocumentSequence -
// see this file's top comment for why it is copied rather than imported.
async function reserveDocumentSequence(
  tx: Prisma.TransactionClient,
  organizationId: string,
  documentType: string,
  scopeKey = "",
): Promise<number> {
  const rows = await tx.$queryRaw<{ currentValue: number }[]>(Prisma.sql`
    INSERT INTO "DocumentSequence" ("id", "organizationId", "documentType", "scopeKey", "currentValue", "updatedAt")
    VALUES (md5(random()::text || clock_timestamp()::text), ${organizationId}, ${documentType}, ${scopeKey}, 1, NOW())
    ON CONFLICT ("organizationId", "documentType", "scopeKey")
    DO UPDATE SET "currentValue" = "DocumentSequence"."currentValue" + 1, "updatedAt" = NOW()
    RETURNING "currentValue"
  `);
  return Number(rows[0].currentValue);
}

// Verbatim copy of lib/server/customers.ts#nextCustomerCode's collision
// guard (snapshot + per-candidate final re-check) - see that function's
// doc comment for the precise guarantee and its known residual limits.
async function nextFreeCustomerCode(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<string> {
  const [occupiedCustomers, occupiedAccounts] = await Promise.all([
    tx.customer.findMany({
      where: { organizationId, code: { startsWith: CUSTOMER_ACCOUNT_PREFIX } },
      select: { code: true },
    }),
    tx.accountingAccount.findMany({
      where: { organizationId, code: { startsWith: CUSTOMER_ACCOUNT_PREFIX } },
      select: { code: true },
    }),
  ]);
  const occupiedCodes = new Set([
    ...occupiedCustomers.map((row) => row.code),
    ...occupiedAccounts.map((row) => row.code),
  ]);

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const number = await reserveDocumentSequence(tx, organizationId, CUSTOMER_CODE_DOCUMENT_TYPE);
    const code = `${CUSTOMER_ACCOUNT_PREFIX}${number}`;
    if (occupiedCodes.has(code)) continue;

    const [collidingCustomer, collidingAccount] = await Promise.all([
      tx.customer.findFirst({ where: { organizationId, code }, select: { id: true } }),
      tx.accountingAccount.findFirst({ where: { organizationId, code }, select: { id: true } }),
    ]);
    if (!collidingCustomer && !collidingAccount) return code;
    occupiedCodes.add(code);
  }
  throw new Error("Impossible de generer un code client libre pour cette organisation.");
}

// Verbatim copy of lib/server/accounting.ts#resolveCustomerAuxiliaryCode's
// relevant branch: a code already shaped "3421"+digits (which is exactly
// what nextFreeCustomerCode above always produces) passes through
// unchanged. Kept as its own function, rather than assuming the identity,
// so this script stays correct if that resolution rule ever changes.
function resolveCustomerAuxiliaryCode(code: string): string {
  if (/^3421\d+$/.test(code)) return code;
  return code;
}

// Verbatim copy of lib/server/accounting.ts#ensureAccountingAccountByCode -
// see this file's top comment for why it is copied rather than imported.
async function ensureAccountingAccountByCode(
  tx: Prisma.TransactionClient,
  organizationId: string,
  input: { code: string; name: string; type: "RECEIVABLE" },
): Promise<{ id: string; created: boolean }> {
  const existing = await tx.accountingAccount.findFirst({
    where: { code: input.code, organizationId },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  const created = await tx.accountingAccount.create({
    data: {
      organizationId,
      code: input.code,
      name: input.name,
      type: input.type,
      isActive: true,
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

// customerAccountNumber("34211") -> "1" (lib/customer-code.ts) - reproduced
// here only for the human-readable log line below, never used for storage.
function displayAccountNumber(code: string): string {
  if (!code.startsWith(CUSTOMER_ACCOUNT_PREFIX)) return code;
  return code.slice(CUSTOMER_ACCOUNT_PREFIX.length).replace(/^0+(?=\d)/, "");
}

async function resolveTargetOrganization() {
  const matches = await prisma.organization.findMany({
    where: { code: AITSALAH_STORE_ORGANIZATION_CODE },
    select: { id: true, name: true, code: true },
  });
  if (matches.length === 0) {
    throw new Error(
      `Aucune organisation avec code "${AITSALAH_STORE_ORGANIZATION_CODE}" - rien créé.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `${matches.length} organisations partagent le code "${AITSALAH_STORE_ORGANIZATION_CODE}" (devrait être unique) - rien créé. IDs : ${matches.map((m) => m.id).join(", ")}`,
    );
  }
  return matches[0];
}

async function main() {
  const org = await resolveTargetOrganization();
  console.log(`Organisation cible : ${org.name} (${org.code}, id ${org.id})`);

  const existing = await prisma.customer.findFirst({
    where: {
      organizationId: org.id,
      name: { equals: DEFAULT_POS_CUSTOMER_NAME, mode: "insensitive" },
    },
    select: { id: true, code: true, name: true, status: true, organizationId: true },
  });

  if (existing) {
    console.log("Client 'Autre' déjà existant (idempotent - aucune recréation) :");
    console.log(existing);
    console.log(`N° client affiché : ${displayAccountNumber(existing.code)}`);

    const auxiliaryCode = resolveCustomerAuxiliaryCode(existing.code);
    const auxiliaryAccount = await prisma.accountingAccount.findFirst({
      where: { organizationId: org.id, code: auxiliaryCode },
      select: { id: true, code: true, name: true, type: true },
    });

    if (!auxiliaryAccount) {
      console.log("Compte auxiliaire manquant - création immédiate (dans une transaction dédiée)...");
      const created = await prisma.$transaction((tx) =>
        ensureAccountingAccountByCode(tx, org.id, {
          code: auxiliaryCode,
          name: DEFAULT_POS_CUSTOMER_NAME,
          type: AUXILIARY_ACCOUNT_TYPE,
        }),
      );
      console.log("Compte auxiliaire créé :", { id: created.id, code: auxiliaryCode, name: DEFAULT_POS_CUSTOMER_NAME });
      return;
    }

    if (auxiliaryAccount.name.trim().toLowerCase() !== DEFAULT_POS_CUSTOMER_NAME.toLowerCase()) {
      console.error("STOP - CONFLIT : le compte auxiliaire attendu pour 'Autre' existe déjà sous un autre nom.");
      console.error(`Code ${auxiliaryCode} appartient à : ${JSON.stringify(auxiliaryAccount)}`);
      console.error("Aucune modification effectuée - ce compte n'est jamais renommé automatiquement.");
      process.exitCode = 1;
      return;
    }

    console.log("Compte auxiliaire déjà correct - aucune action :", auxiliaryAccount);
    return;
  }

  const adminUser = await prisma.user.findFirst({
    where: { organizationId: org.id, role: "ADMIN", status: "ACTIVE" },
    select: { id: true, fullName: true },
  });
  if (!adminUser) {
    throw new Error("Aucun administrateur actif trouvé pour cette organisation - rien créé.");
  }

  const result = await prisma.$transaction(async (tx) => {
    const code = await nextFreeCustomerCode(tx, org.id);

    const customer = await tx.customer.create({
      data: {
        organizationId: org.id,
        code,
        name: DEFAULT_POS_CUSTOMER_NAME,
        phone: null,
        email: null,
        // Same placeholder convention as "Client Comptoir" (id
        // client-comptoir), this organization's other generic/walk-in
        // customer.
        address: "Depot principal",
        city: "Casablanca",
        type: "COUNTER",
        status: "ACTIVE",
        creditLimit: 0,
        creditLimitEnabled: false,
        currentBalance: 0,
        createdByUserId: adminUser.id,
        creationOrigin: "ADMIN",
      },
      select: { id: true, code: true, name: true, organizationId: true, status: true, type: true },
    });

    const auxiliaryCode = resolveCustomerAuxiliaryCode(customer.code);
    const account = await ensureAccountingAccountByCode(tx, org.id, {
      code: auxiliaryCode,
      name: DEFAULT_POS_CUSTOMER_NAME,
      type: AUXILIARY_ACCOUNT_TYPE,
    });

    return { customer, account, auxiliaryCode };
  });

  console.log("Client 'Autre' créé :");
  console.log(result.customer);
  console.log(`N° client affiché : ${displayAccountNumber(result.customer.code)}`);
  console.log("Compte auxiliaire créé dans la même transaction :", {
    id: result.account.id,
    code: result.auxiliaryCode,
    name: DEFAULT_POS_CUSTOMER_NAME,
    type: AUXILIARY_ACCOUNT_TYPE,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
