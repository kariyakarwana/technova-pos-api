import { Body, Controller, Headers, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { WebhookDto } from './dto/notification.dto';
import { NotificationsService } from './notifications.service';
type RawRequest = Request & { rawBody?: Buffer };
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly notifications: NotificationsService) {}
  @Post(':provider') receive(
    @Param('provider') provider: string,
    @Body() dto: WebhookDto,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Req() request: RawRequest,
  ) {
    return this.notifications.webhook(
      provider,
      dto.providerEventId,
      dto.eventType,
      dto.payload,
      request.rawBody,
      signature,
    );
  }
}
