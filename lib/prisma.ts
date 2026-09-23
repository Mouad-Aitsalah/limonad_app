import "server-only";

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/lib/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaSchemaSignature?: string;
};

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prismaSchemaSignature = createHash("sha1")
  .update(
    readFileSync(path.join(process.cwd(), "lib/generated/prisma/internal/class.ts"), "utf8"),
  )
  .digest("hex");

// PRISMA_DEBUG_QUERIES=1 (local diagnostics only, never set in a deployed
// environment): logs every query with its own duration and a running
// count/elapsed total, to see exactly which statement a slow transaction is
// spending its time on instead of guessing from the code alone. Fully
// opt-in and additive - the log array below is unchanged when the env var
// is absent, so normal behavior (including production's ["error"]-only
// logging) is untouched.
function createPrismaClient() {
  const debugQueries = process.env.PRISMA_DEBUG_QUERIES === "1";
  const client = new PrismaClient({
    adapter,
    log: debugQueries
      ? [{ emit: "event", level: "query" }, "error", "warn"]
      : process.env.NODE_ENV === "development"
        ? ["error", "warn"]
        : ["error"],
  });
  if (debugQueries) {
    let count = 0;
    const start = Date.now();
    (client as unknown as { $on: (event: "query", cb: (e: { query: string; duration: number }) => void) => void }).$on(
      "query",
      (e) => {
        count += 1;
        console.log(
          `[PRISMA #${count} +${Date.now() - start}ms dur=${e.duration}ms] ${e.query.slice(0, 140)}`,
        );
      },
    );
  }
  return client;
}

const hasMatchingGlobalClient =
  globalForPrisma.prisma &&
  globalForPrisma.prismaSchemaSignature === prismaSchemaSignature;

if (
  process.env.NODE_ENV !== "production" &&
  globalForPrisma.prisma &&
  !hasMatchingGlobalClient
) {
  void globalForPrisma.prisma.$disconnect().catch(() => undefined);
}

export const prisma = hasMatchingGlobalClient
  ? globalForPrisma.prisma!
  : createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaSchemaSignature = prismaSchemaSignature;
}
