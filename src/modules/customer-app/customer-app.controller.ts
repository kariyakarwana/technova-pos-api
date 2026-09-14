import {
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { CustomerAppService } from './customer-app.service';
import {
  CustomerNotificationQueryDto,
  CustomerProductQueryDto,
} from './dto/customer-app.dto';

@Controller('customer-app')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('customer-app:access')
export class CustomerAppController {
  constructor(private readonly customerApp: CustomerAppService) {}

  @Get('home')
  home(@CurrentUser() user: AuthenticatedUser) {
    return this.customerApp.home(user.id);
  }

  @Get('profile')
  profile(@CurrentUser() user: AuthenticatedUser) {
    return this.customerApp.profile(user.id);
  }

  @Get('loyalty')
  loyalty(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CustomerNotificationQueryDto,
  ) {
    return this.customerApp.loyalty(user.id, query);
  }

  @Get('products')
  products(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CustomerProductQueryDto,
  ) {
    return this.customerApp.products(user.id, query);
  }

  @Get('categories')
  categories(@CurrentUser() user: AuthenticatedUser) {
    return this.customerApp.categories(user.id);
  }

  @Get('credit-purchases')
  creditPurchases(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CustomerNotificationQueryDto,
  ) {
    return this.customerApp.creditPurchases(user.id, query);
  }

  @Get('promotions')
  promotions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CustomerNotificationQueryDto,
  ) {
    return this.customerApp.promotions(user.id, query);
  }

  @Get('notifications')
  notifications(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CustomerNotificationQueryDto,
  ) {
    return this.customerApp.notifications(user.id, query);
  }

  @Patch('notifications/read-all')
  readAllNotifications(@CurrentUser() user: AuthenticatedUser) {
    return this.customerApp.readAllNotifications(user.id);
  }

  @Patch('notifications/:id/read')
  readNotification(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.customerApp.readNotification(user.id, id);
  }
}
