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
import { getSecurityRequestContext } from '../../common/security/request';
import {
  AllocateAddonDto,
  ChangeTenantPlanDto,
  CreateAddonPackDto,
  CreatePlanDto,
  CreateTenantDto,
  RecordPaymentDto,
  ReviewSubscriptionRequestDto,
  UpdateAddonPackDto,
  UpdateOrganizationDto,
  UpdatePlanDto,
  UpdateTenantAdminDto,
  UpdateTenantStatusDto,
} from './dto/platform-admin.dto';
import { PlatformAdminGuard } from './guards/platform-admin.guard';
import { PlatformAdminService } from './platform-admin.service';

@Controller('platform-admin')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class PlatformAdminController {
  constructor(private readonly platformAdmin: PlatformAdminService) {}

  @Get('analytics')
  getAnalytics() {
    return this.platformAdmin.getPlatformAnalytics();
  }

  @Get('organizations')
  listOrganizations() {
    return this.platformAdmin.listOrganizations();
  }

  @Get('invoices')
  listInvoices() {
    return this.platformAdmin.listInvoices();
  }

  @Get('audit-logs')
  listAuditLogs() {
    return this.platformAdmin.listAuditLogs();
  }

  @Post('organizations')
  createOrganization(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTenantDto,
    @Req() request: Request,
  ) {
    return this.platformAdmin.createTenant(
      dto,
      user,
      getSecurityRequestContext(request),
    );
  }

  @Patch('organizations/:id/status')
  updateStatus(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateTenantStatusDto,
    @Req() request: Request,
  ) {
    return this.platformAdmin.updateTenantStatus(
      id,
      dto,
      user,
      getSecurityRequestContext(request),
    );
  }

  @Patch('organizations/:id/plan')
  changePlan(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangeTenantPlanDto,
    @Req() request: Request,
  ) {
    return this.platformAdmin.changeTenantPlan(
      id,
      dto,
      user,
      getSecurityRequestContext(request),
    );
  }

  @Post('organizations/:id/addons')
  allocateAddon(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AllocateAddonDto,
    @Req() request: Request,
  ) {
    return this.platformAdmin.allocateAddon(
      id,
      dto,
      user,
      getSecurityRequestContext(request),
    );
  }

  @Post('invoices/:id/record-payment')
  recordPayment(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RecordPaymentDto,
    @Req() request: Request,
  ) {
    return this.platformAdmin.recordPayment(
      id,
      dto,
      user,
      getSecurityRequestContext(request),
    );
  }
  @Patch('organizations/:id')
  updateOrganization(@Param('id') id: string, @Body() dto: UpdateOrganizationDto) {
    return this.platformAdmin.updateOrganization(id, dto);
  }

  @Patch('organizations/:id/tenant-admin')
  updateTenantAdmin(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateTenantAdminDto,
    @Req() request: Request,
  ) {
    return this.platformAdmin.updateTenantAdmin(
      id,
      dto,
      user,
      getSecurityRequestContext(request),
    );
  }

  // Commercial Plans Catalog CRUD
  @Get('plans')
  listPlans() {
    return this.platformAdmin.listPlans();
  }

  @Post('plans')
  createPlan(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePlanDto,
    @Req() request: Request,
  ) {
    return this.platformAdmin.createPlan(
      dto,
      user,
      getSecurityRequestContext(request),
    );
  }

  @Patch('plans/:id')
  updatePlan(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdatePlanDto,
    @Req() request: Request,
  ) {
    return this.platformAdmin.updatePlan(
      id,
      dto,
      user,
      getSecurityRequestContext(request),
    );
  }

  // Add-on Packs Catalog CRUD
  @Get('addon-packs')
  listAddonPacks() {
    return this.platformAdmin.listAddonPacks();
  }

  @Post('addon-packs')
  createAddonPack(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAddonPackDto,
    @Req() request: Request,
  ) {
    return this.platformAdmin.createAddonPack(
      dto,
      user,
      getSecurityRequestContext(request),
    );
  }

  @Patch('addon-packs/:id')
  updateAddonPack(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateAddonPackDto,
    @Req() request: Request,
  ) {
    return this.platformAdmin.updateAddonPack(
      id,
      dto,
      user,
      getSecurityRequestContext(request),
    );
  }

  // Tenant Plan Change & Add-on Requests Review
  @Get('subscription-requests')
  listSubscriptionRequests() {
    return this.platformAdmin.listSubscriptionRequests();
  }

  @Patch('subscription-requests/:id/review')
  reviewSubscriptionRequest(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReviewSubscriptionRequestDto,
    @Req() request: Request,
  ) {
    return this.platformAdmin.reviewSubscriptionRequest(
      id,
      dto,
      user,
      getSecurityRequestContext(request),
    );
  }

  // Unified Notifications & Automated Billing Reminders
  @Get('notifications')
  listPlatformNotifications() {
    return this.platformAdmin.listPlatformNotifications();
  }

  @Post('notifications/dispatch-reminders')
  dispatchPaymentReminders() {
    return this.platformAdmin.dispatchPaymentReminders();
  }
}
