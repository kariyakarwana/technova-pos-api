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
import { CreateSaleDto, SaleQueryDto, SaleQuoteDto } from './dto/sale.dto';
import { SalesService } from './sales.service';
@Controller('sales')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SalesController {
  constructor(private readonly sales: SalesService) {}
  @Get() @RequirePermissions('sales:view') list(
    @CurrentUser() u: AuthenticatedUser,
    @Query() q: SaleQueryDto,
  ) {
    return this.sales.list(u.id, q);
  }
  @Get('pos-context') @RequirePermissions('sales:manage') posContext(
    @CurrentUser() u: AuthenticatedUser,
    @Query('branchId') branchId: string,
  ) {
    return this.sales.posContext(u, branchId);
  }
  @Get(':id') @RequirePermissions('sales:view') detail(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.sales.detail(u.id, id);
  }
  @Post() @RequirePermissions('sales:manage') create(
    @CurrentUser() u: AuthenticatedUser,
    @Body() d: CreateSaleDto,
    @Req() r: Request,
  ) {
    return this.sales.create(u, d, getSecurityRequestContext(r));
  }

  @Post('quote') @RequirePermissions('sales:manage') quote(
    @CurrentUser() u: AuthenticatedUser,
    @Body() d: SaleQuoteDto,
  ) {
    return this.sales.quote(u.id, d.items);
  }
}
