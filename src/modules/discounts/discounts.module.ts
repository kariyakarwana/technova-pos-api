import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { DiscountsController } from './discounts.controller';
import { DiscountsService } from './discounts.service';
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [DiscountsController],
  providers: [DiscountsService],
})
export class DiscountsModule {}
