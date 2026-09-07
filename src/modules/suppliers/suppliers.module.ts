import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';
import { SupplierPortalController } from './supplier-portal.controller';
import { SupplierPortalService } from './supplier-portal.service';
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [SuppliersController, SupplierPortalController],
  providers: [SuppliersService, SupplierPortalService],
  exports: [SupplierPortalService],
})
export class SuppliersModule {}
