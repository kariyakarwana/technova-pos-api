import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { getSecurityRequestContext } from '../../common/security/request';
import {
  CreatePurchaseOrderDto,
  PurchaseQueryDto,
  ReceivePurchaseOrderDto,
} from './dto/purchasing.dto';
import { PurchasingService } from './purchasing.service';
@Controller('purchasing')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PurchasingController {
  constructor(private readonly purchasing: PurchasingService) {}
  @Get('orders') @RequirePermissions('purchases:view') list(
    @CurrentUser() u: AuthenticatedUser,
    @Query() q: PurchaseQueryDto,
  ) {
    return this.purchasing.list(u.id, q);
  }
  @Get('orders/:id') @RequirePermissions('purchases:view') detail(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.purchasing.detail(u.id, id);
  }
  @Post('orders') @RequirePermissions('purchases:manage') create(
    @CurrentUser() u: AuthenticatedUser,
    @Body() d: CreatePurchaseOrderDto,
    @Req() r: Request,
  ) {
    return this.purchasing.create(u, d, getSecurityRequestContext(r));
  }
  @Post('orders/:id/approve') @RequirePermissions('purchases:manage') approve(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
    @Req() r: Request,
  ) {
    return this.purchasing.approve(u, id, getSecurityRequestContext(r));
  }
  @Post('orders/:id/receipts') @RequirePermissions('purchases:manage') receive(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
    @Body() d: ReceivePurchaseOrderDto,
    @Req() r: Request,
  ) {
    return this.purchasing.receive(u, id, d, getSecurityRequestContext(r));
  }
  @Post('orders/:id/receipts/:receiptId/reissue-labels')
  @RequirePermissions('purchases:manage')
  reissueLabels(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
    @Param('receiptId') receiptId: string,
  ) {
    return this.purchasing.reissueReceiptLabels(u.id, id, receiptId);
  }
}
