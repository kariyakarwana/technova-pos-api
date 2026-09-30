import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyService } from './loyalty.service';

@Module({
  imports: [AuditModule, AuthModule],
  controllers: [LoyaltyController],
  providers: [LoyaltyService],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
