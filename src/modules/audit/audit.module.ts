import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditController } from './audit.controller';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
