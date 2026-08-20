


import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { hash } from "bcryptjs";
import { PrismaClient, UserStatus } from "@prisma/client";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const permissions = [
  {
    key: "dashboard:view",
    description: "View the main dashboard",
  },
  {
    key: "users:manage",
    description: "Create, update, activate and deactivate users",
  },
  {
    key: "roles:manage",
    description: "Manage roles and permissions",
  },
  {
    key: "audit:view",
    description: "View security and system audit events",
  },
  {
    key: "sales:manage",
    description: "Manage sales transactions",
  },
  {
    key: "inventory:manage",
    description: "Manage products and inventory",
  },
  {
    key: "purchases:manage",
    description: "Manage purchases and suppliers",
  },
  {
    key: "settings:manage",
    description: "Manage system settings",
  },
];

async function main() {
  const email = process.env.SUPER_ADMIN_EMAIL
    ?.trim()
    .toLowerCase();

  const password = process.env.SUPER_ADMIN_PASSWORD;

  if (!email) {
    throw new Error("SUPER_ADMIN_EMAIL is required.");
  }

  if (
    !password ||
    password === "Replace!WithStrongPassword2026" ||
    password.length < 12
  ) {
    throw new Error(
      "Set a non-default SUPER_ADMIN_PASSWORD with at least 12 characters.",
    );
  }

  const superAdminRole = await prisma.role.upsert({
    where: {
      name: "SUPER_ADMIN",
    },
    update: {
      description: "Full system administrator",
      isSystem: true,
    },
    create: {
      name: "SUPER_ADMIN",
      description: "Full system administrator",
      isSystem: true,
    },
  });

  for (const permissionData of permissions) {
    const permission = await prisma.permission.upsert({
      where: {
        key: permissionData.key,
      },
      update: {
        description: permissionData.description,
      },
      create: permissionData,
    });

    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: superAdminRole.id,
          permissionId: permission.id,
        },
      },
      update: {},
      create: {
        roleId: superAdminRole.id,
        permissionId: permission.id,
      },
    });
  }

  const passwordHash = await hash(password, 12);

  const superAdmin = await prisma.user.upsert({
    where: {
      email,
    },
    update: {
      name: "Super Admin",
      passwordHash,
      emailVerified: new Date(),
      status: UserStatus.ACTIVE,
    },
    create: {
      email,
      name: "Super Admin",
      passwordHash,
      emailVerified: new Date(),
      status: UserStatus.ACTIVE,
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: superAdmin.id,
        roleId: superAdminRole.id,
      },
    },
    update: {},
    create: {
      userId: superAdmin.id,
      roleId: superAdminRole.id,
    },
  });

  console.info(`Super Admin seeded: ${email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
