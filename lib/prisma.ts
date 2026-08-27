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

function createPrismaClient() {
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
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
