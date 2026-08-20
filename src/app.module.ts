import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { DatabaseModule } from './database/database.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { BranchesModule } from './modules/branches/branches.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { HealthModule } from './modules/health/health.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { RolesModule } from './modules/roles/roles.module';
import { PurchasingModule } from './modules/purchasing/purchasing.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
    }),

    DatabaseModule,
    IdempotencyModule,
    AuditModule,
    AuthModule,
    OrganizationsModule,
    BranchesModule,
    CatalogModule,
    RolesModule,
    SuppliersModule,
    PurchasingModule,
    UsersModule,
    HealthModule,
  ],
})
export class AppModule {}
