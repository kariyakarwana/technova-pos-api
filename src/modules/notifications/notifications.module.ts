import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { WebhooksController } from './webhooks.controller';
import { NotificationWorkerService } from './notification-worker.service';
@Module({
  imports: [AuthModule],
  controllers: [NotificationsController, WebhooksController],
  providers: [NotificationsService, NotificationWorkerService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
