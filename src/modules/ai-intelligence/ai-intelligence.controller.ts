import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { AiIntelligenceService } from './ai-intelligence.service';

@Controller('ai-intelligence')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AiIntelligenceController {
  constructor(private readonly intelligence: AiIntelligenceService) {}

  @Get('overview')
  @RequirePermissions('dashboard:view')
  overview(
    @CurrentUser() user: AuthenticatedUser,
    @Query('branchId') branchId?: string,
    @Query('forecastDays') forecastDays?: string,
  ) {
    return this.intelligence.overview(user.id, {
      branchId,
      forecastDays: Number(forecastDays || 30),
    });
  }

  @Get('loyalty/:customerId')
  @RequirePermissions('customers:view')
  loyalty(
    @CurrentUser() user: AuthenticatedUser,
    @Param('customerId') customerId: string,
    @Query('topK') topK?: string,
  ) {
    return this.intelligence.loyalty(user.id, customerId, Number(topK || 5));
  }
}
