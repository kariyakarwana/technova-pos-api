import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [SuppliersController],
  providers: [SuppliersService],
})
export class SuppliersModule {}
