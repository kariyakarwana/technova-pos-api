import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { getSecurityRequestContext } from '../../common/security/request';
import {
  AdjustLoyaltyPointsDto,
  CreateLoyaltyRuleDto,
  UpdateLoyaltyRuleDto,
} from './dto/loyalty.dto';
import { LoyaltyService } from './loyalty.service';

@Controller('loyalty')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get('rules')
  @RequirePermissions('customers:view')
  rules(@CurrentUser() user: AuthenticatedUser) {
    return this.loyalty.rules(user.id);
  }

  @Post('rules')
  @RequirePermissions('customers:manage')
  createRule(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateLoyaltyRuleDto,
    @Req() request: Request,
  ) {
    return this.loyalty.createRule(user, dto, getSecurityRequestContext(request));
  }

  @Patch('rules/:id')
  @RequirePermissions('customers:manage')
  updateRule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateLoyaltyRuleDto,
    @Req() request: Request,
  ) {
    return this.loyalty.updateRule(user, id, dto, getSecurityRequestContext(request));
  }

  @Get('customers/:customerId')
  @RequirePermissions('customers:view')
  customer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('customerId') customerId: string,
  ) {
    return this.loyalty.customer(user.id, customerId);
  }

  @Post('customers/:customerId/adjustments')
  @RequirePermissions('customers:manage')
  adjust(
    @CurrentUser() user: AuthenticatedUser,
    @Param('customerId') customerId: string,
    @Body() dto: AdjustLoyaltyPointsDto,
    @Req() request: Request,
  ) {
    return this.loyalty.adjust(user, customerId, dto, getSecurityRequestContext(request));
  }

  @Get('rule-recommendations')
  @RequirePermissions('customers:view')
  recommendations(@CurrentUser() user: AuthenticatedUser) {
    return this.loyalty.ruleRecommendations(user.id);
  }
}
