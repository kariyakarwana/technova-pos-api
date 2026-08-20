import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { PurchasingController } from './purchasing.controller';
import { PurchasingService } from './purchasing.service';
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [PurchasingController],
  providers: [PurchasingService],
})
export class PurchasingModule {}
