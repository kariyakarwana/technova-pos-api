import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { CreditController } from './credit.controller';
import { CreditService } from './credit.service';
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [CreditController],
  providers: [CreditService],
})
export class CreditModule {}
