import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { AiIntelligenceService } from './ai-intelligence.service';
import { DemandForecastDto } from './dto/demand-forecast.dto';
import { RecommendationDto } from './dto/recommendation.dto';

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

  @Get('sales-forecast')
  @RequirePermissions('dashboard:view')
  salesForecast(
    @CurrentUser() user: AuthenticatedUser,
    @Query('branchId') branchId?: string,
    @Query('forecastHorizon') forecastHorizon?: string,
    @Query('horizon') horizon?: string,
  ) {
    const rawHorizon = forecastHorizon ?? horizon;
    return this.intelligence.salesForecast(user.id, {
      branchId,
      forecastHorizon: rawHorizon ? Number(rawHorizon) : undefined,
    });
  }

  @Get('demand-forecast')
  @RequirePermissions('dashboard:view')
  demandForecast(
    @CurrentUser() user: AuthenticatedUser,
    @Query('branchId') branchId?: string,
    @Query('forecastHorizon') forecastHorizon?: string,
    @Query('horizon') horizon?: string,
    @Query('productId') productId?: string,
    @Query('category') category?: string,
    @Query('baseUnitPrice') baseUnitPrice?: string,
    @Query('unitPrice') unitPrice?: string,
    @Query('storeType') storeType?: string,
    @Query('assortment') assortment?: string,
    @Query('promo2') promo2?: string,
  ) {
    const rawHorizon = forecastHorizon ?? horizon;
    return this.intelligence.demandForecast(user.id, {
      branchId,
      productId,
      category,
      baseUnitPrice: baseUnitPrice ? Number(baseUnitPrice) : undefined,
      unitPrice: unitPrice ? Number(unitPrice) : undefined,
      storeType,
      assortment,
      promo2: promo2 !== undefined ? Number(promo2) : undefined,
      forecastHorizon: rawHorizon ? Number(rawHorizon) : undefined,
    });
  }

  @Post('demand-forecast')
  @RequirePermissions('dashboard:view')
  createDemandForecast(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DemandForecastDto,
  ) {
    return this.intelligence.demandForecast(user.id, dto);
  }

  @Post('demand-forecast/forecast')
  @RequirePermissions('dashboard:view')
  createDemandForecastAlias(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DemandForecastDto,
  ) {
    return this.intelligence.demandForecast(user.id, dto);
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

  @Post('recommendations/recommend')
  @RequirePermissions('dashboard:view')
  recommend(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RecommendationDto,
  ) {
    return this.intelligence.getRecommendations(user.id, dto);
  }
}
