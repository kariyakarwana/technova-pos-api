import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { PublicReceiptsController } from './public-receipts.controller';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [SalesController, PublicReceiptsController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
