import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
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
  CreateDiscountRuleDto,
  UpdateDiscountRuleDto,
} from './dto/discount.dto';
import { DiscountsService } from './discounts.service';
@Controller('discounts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DiscountsController {
  constructor(private readonly discounts: DiscountsService) {}
  @Get() @RequirePermissions('sales:view') list(
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.discounts.list(u.id);
  }
  @Post() @RequirePermissions('discounts:manage') create(
    @CurrentUser() u: AuthenticatedUser,
    @Body() d: CreateDiscountRuleDto,
    @Req() r: Request,
  ) {
    return this.discounts.create(u, d, getSecurityRequestContext(r));
  }
  @Patch(':id') @RequirePermissions('discounts:manage') update(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
    @Body() d: UpdateDiscountRuleDto,
    @Req() r: Request,
  ) {
    return this.discounts.update(u, id, d, getSecurityRequestContext(r));
  }
}
