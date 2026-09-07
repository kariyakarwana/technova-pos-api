import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import {
  CreateTemplateDto,
  AppNotificationQueryDto,
  OutboxQueryDto,
  PreferenceDto,
  UpdateTemplateDto,
} from './dto/notification.dto';
import { NotificationsService } from './notifications.service';
@Controller('notifications')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}
  @Get('in-app')
  inApp(
    @CurrentUser() u: AuthenticatedUser,
    @Query() q: AppNotificationQueryDto,
  ) {
    return this.notifications.appNotifications(u.id, q);
  }
  @Patch('in-app/read-all')
  readAll(@CurrentUser() u: AuthenticatedUser) {
    return this.notifications.readAllAppNotifications(u.id);
  }
  @Patch('in-app/:id/read')
  read(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string) {
    return this.notifications.readAppNotification(u.id, id);
  }
  @Get('templates') @RequirePermissions('notifications:manage') templates(
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.notifications.templates(u.id);
  }
  @Get('templates/catalog')
  @RequirePermissions('notifications:manage')
  templateCatalog() {
    return this.notifications.templateCatalog();
  }
  @Post('templates') @RequirePermissions('notifications:manage') create(
    @CurrentUser() u: AuthenticatedUser,
    @Body() d: CreateTemplateDto,
  ) {
    return this.notifications.createTemplate(u.id, d);
  }
  @Patch('templates/:id') @RequirePermissions('notifications:manage') update(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
    @Body() d: UpdateTemplateDto,
  ) {
    return this.notifications.updateTemplate(u.id, id, d);
  }
  @Post('preferences') @RequirePermissions('customers:manage') preference(
    @CurrentUser() u: AuthenticatedUser,
    @Body() d: PreferenceDto,
  ) {
    return this.notifications.preference(u.id, d);
  }
  @Get('outbox') @RequirePermissions('notifications:manage') outbox(
    @CurrentUser() u: AuthenticatedUser,
    @Query() q: OutboxQueryDto,
  ) {
    return this.notifications.outbox(u.id, q);
  }
  @Post('outbox/process')
  @RequirePermissions('notifications:manage')
  process() {
    return this.notifications.processPending();
  }
  @Get('provider-status')
  @RequirePermissions('notifications:manage')
  providerStatus() {
    return this.notifications.providerStatus();
  }
}
