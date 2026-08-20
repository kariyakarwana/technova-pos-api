import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { WebhooksController } from './webhooks.controller';
@Module({
  imports: [AuthModule],
  controllers: [NotificationsController, WebhooksController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
