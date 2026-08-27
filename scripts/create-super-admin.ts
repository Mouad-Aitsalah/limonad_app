import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

import { PrismaClient } from "../lib/generated/prisma/client";

const databaseUrl = process.env.DATABASE_URL;
const password = process.env.SUPERADMIN_PASSWORD;

if (!databaseUrl) {
  throw new Error("DATABASE_URL est manquant");
}

if (!password || password.length < 8) {
  throw new Error(
    "SUPERADMIN_PASSWORD est manquant ou contient moins de 8 caractères",
  );
}

const adapter = new PrismaPg({
  connectionString: databaseUrl,
});

const prisma = new PrismaClient({ adapter });

async function main() {
  const passwordHash = await bcrypt.hash(password, 12);

  const superAdmin = await prisma.user.upsert({
    where: {
      id: "user-super-admin",
    },

    update: {
      firstName: "Super",
      lastName: "Admin",
      fullName: "Super Admin COMDIS",
      email: "superadmin@comdis.local",
      passwordHash,
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      organizationId: null,
      depotId: null,
    },

    create: {
      id: "user-super-admin",
      firstName: "Super",
      lastName: "Admin",
      fullName: "Super Admin COMDIS",
      email: "superadmin@comdis.local",
      passwordHash,
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      organizationId: null,
      depotId: null,
    },
  });

  console.log("SUPER_ADMIN créé :", superAdmin.email);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });