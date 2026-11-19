import { PaginationDto } from '../../common/dto/pagination.dto';
import {
  Body,
  Query,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { PlanChangeRequestDto, AddonRequestDto } from './subscription.dto';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { PrismaService } from '../../database/prisma/prisma.service';
import { QuotaService } from './quota.service';
import { SubscriptionsService } from './subscriptions.service';

@Controller('subscription')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('billing:view')
export class SubscriptionsController {
  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly quota: QuotaService,
    private readonly prisma: PrismaService,
  ) {}

  private async getOrganizationId(userId: string): Promise<string> {
    const membership = await this.prisma.organizationUser.findFirst({
      where: { userId },
    });
    if (!membership) {
      throw new NotFoundException('Organization membership not found.');
    }
    return membership.organizationId;
  }

  @Get('plans')
  getPlans() {
    return this.subscriptions.getPlans();
  }

  @Get('addon-packs')
  getAddonPacks() {
    return this.subscriptions.getAddonCatalog();
  }

  @Get('billing')
  async getBillingOverview(@CurrentUser() user: AuthenticatedUser) {
    const organizationId = await this.getOrganizationId(user.id);
    return this.subscriptions.getSubscriptionDetails(organizationId);
  }

  @Get('usage')
  async getUsage(@CurrentUser() user: AuthenticatedUser) {
    const organizationId = await this.getOrganizationId(user.id);
    return this.quota.getUsageOverview(organizationId);
  }

  @Get('invoices')
  async getInvoices(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationDto) {
    const organizationId = await this.getOrganizationId(user.id);
    return this.subscriptions.getInvoices(organizationId, query);
  }

  @RequirePermissions('billing:manage')
  @Post('plan-change-request')
  async requestPlanChange(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: PlanChangeRequestDto,
  ) {
    const organizationId = await this.getOrganizationId(user.id);
    return this.subscriptions.requestPlanChange(organizationId, user.id, body);
  }

  @RequirePermissions('billing:manage')
  @Post('addons')
  async requestAddon(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AddonRequestDto,
  ) {
    const organizationId = await this.getOrganizationId(user.id);
    return this.subscriptions.requestAddon(
      organizationId,
      body.type,
      body.quantity ?? 1,
      {
        userId: user.id,
        notes: body.notes,
        paymentRef: body.paymentRef,
      },
    );
  }

  @RequirePermissions('billing:manage')
  @Post('invoices/:id/pay-online')
  async payInvoiceOnline(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') invoiceId: string,
    @Body()
    body: {
      paymentMethod?: string;
      cardBrand?: string;
      cardLast4?: string;
      cardHolderName?: string;
      gatewayRef?: string;
    },
  ) {
    const organizationId = await this.getOrganizationId(user.id);
    return this.subscriptions.payInvoiceOnline(organizationId, invoiceId, body);
  }
}
