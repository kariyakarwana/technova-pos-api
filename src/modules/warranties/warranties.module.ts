import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { QrController } from './qr.controller';
import { WarrantiesController } from './warranties.controller';
import { WarrantiesService } from './warranties.service';
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [WarrantiesController, QrController],
  providers: [WarrantiesService],
})
export class WarrantiesModule {}
