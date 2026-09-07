import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { hash } from "bcryptjs";
import { NotificationChannel, PrismaClient, UserStatus } from "@prisma/client";

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
    key: "dashboard:customize",
    description: "Create and customize personal and organization dashboards",
  },
  {
    key: "dashboard:manage_templates",
    description: "Create, update, and manage dashboard layout templates",
  },
  {
    key: "dashboard:manage_themes",
    description: "Create, update, and manage visual themes",
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
  { key: "settings:view", description: "View organization settings" },
  { key: "branches:view", description: "View organization branches" },
  { key: "branches:manage", description: "Create and update branches" },
  { key: "products:view", description: "View products and categories" },
  { key: "products:manage", description: "Manage products and categories" },
  { key: "suppliers:view", description: "View suppliers" },
  { key: "suppliers:manage", description: "Manage suppliers" },
  { key: "purchases:view", description: "View purchase orders and receipts" },
  { key: "inventory:view", description: "View inventory and stock movements" },
  { key: "sales:view", description: "View sales transactions" },
  { key: "customers:view", description: "View customers" },
  { key: "customers:manage", description: "Manage customers and loyalty" },
  { key: "discounts:manage", description: "Manage discount rules" },
  { key: "returns:manage", description: "Manage returns and refunds" },
  { key: "credit:manage", description: "Manage customer credit" },
  { key: "warranties:manage", description: "Manage warranties" },
  { key: "notifications:manage", description: "Manage notification delivery" },
  { key: "reports:view", description: "View and export reports" },
  { key: "supplier-portal:access", description: "Access the assigned supplier portal" },
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

  const supplierRole = await prisma.role.upsert({
    where: { name: "SUPPLIER" },
    update: { description: "External supplier portal user", isSystem: true },
    create: {
      name: "SUPPLIER",
      description: "External supplier portal user",
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
    if (permissionData.key === "supplier-portal:access") {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: supplierRole.id,
            permissionId: permission.id,
          },
        },
        update: {},
        create: { roleId: supplierRole.id, permissionId: permission.id },
      });
    }
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

  const organization = await prisma.organization.upsert({
    where: { registrationNumber: "TECHNOVA-DEMO" },
    update: { name: "TechNova POS" },
    create: {
      name: "TechNova POS",
      registrationNumber: "TECHNOVA-DEMO",
      email,
      branding: {
        create: {
          primaryColor: "#0D9488",
          secondaryColor: "#115E59",
        },
      },
    },
  });

  await prisma.organizationUser.upsert({
    where: {
      organizationId_userId: {
        organizationId: organization.id,
        userId: superAdmin.id,
      },
    },
    update: {},
    create: { organizationId: organization.id, userId: superAdmin.id },
  });

  const mainBranch = await prisma.branch.upsert({
    where: {
      organizationId_code: {
        organizationId: organization.id,
        code: "MAIN",
      },
    },
    update: { name: "Main Branch" },
    create: {
      organizationId: organization.id,
      code: "MAIN",
      name: "Main Branch",
    },
  });

  await prisma.userBranch.upsert({
    where: {
      userId_branchId: { userId: superAdmin.id, branchId: mainBranch.id },
    },
    update: { isDefault: true },
    create: { userId: superAdmin.id, branchId: mainBranch.id, isDefault: true },
  });

  const whatsappEvents = [
    "PRODUCT_CREATED",
    "PURCHASE_ORDER_CREATED",
    "PURCHASE_ORDER_APPROVED",
    "GOODS_RECEIPT_CREATED",
    "INVENTORY_ADJUSTED",
    "STOCK_TRANSFER_CREATED",
    "STOCK_TRANSFER_DISPATCHED",
    "STOCK_TRANSFER_RECEIVED",
    "SALE_COMPLETED",
    "RETURN_COMPLETED",
    "CREDIT_PAYMENT_RECEIVED",
    "WARRANTY_POLICY_CREATED",
    "CREDIT_PAYMENT_REMINDER",
    "LOW_STOCK_ALERT",
  ];

  for (const eventType of whatsappEvents) {
    await prisma.notificationTemplate.upsert({
      where: {
        organizationId_eventType_channel: {
          organizationId: organization.id,
          eventType,
          channel: NotificationChannel.WHATSAPP,
        },
      },
      update: {},
      create: {
        organizationId: organization.id,
        eventType,
        channel: NotificationChannel.WHATSAPP,
        name: `${eventType} WhatsApp notification`,
        bodyTemplate: "TechNova POS: {{eventType}} — {{payload}}",
      },
    });
  }

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
