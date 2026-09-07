import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../../common/auth/jwt-auth.guard';
import { RequirePermissions } from '../../../common/auth/permissions.decorator';
import { PermissionsGuard } from '../../../common/auth/permissions.guard';
import { getSecurityRequestContext } from '../../../common/security/request';
import { DashboardsService } from './dashboards.service';
import {
  ApplyTemplateDto,
  CreateDashboardDto,
  DashboardQueryDto,
  UpdateDashboardDto,
  UpdateDashboardLayoutDto,
} from './dto/dashboard.dto';

@Controller('dashboards')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DashboardsController {
  constructor(private readonly dashboards: DashboardsService) {}

  @Get()
  @RequirePermissions('dashboard:view')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DashboardQueryDto,
  ) {
    return this.dashboards.list(user, query);
  }

  @Get(':id')
  @RequirePermissions('dashboard:view')
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.dashboards.detail(user, id);
  }

  @Post()
  @RequirePermissions('dashboard:customize')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDashboardDto,
    @Req() request: Request,
  ) {
    return this.dashboards.create(
      user,
      dto,
      getSecurityRequestContext(request),
    );
  }

  @Patch(':id')
  @RequirePermissions('dashboard:customize')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateDashboardDto,
    @Req() request: Request,
  ) {
    return this.dashboards.update(
      user,
      id,
      dto,
      getSecurityRequestContext(request),
    );
  }

  @Put(':id/layout')
  @RequirePermissions('dashboard:customize')
  updateLayout(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateDashboardLayoutDto,
    @Req() request: Request,
  ) {
    return this.dashboards.updateLayout(
      user,
      id,
      dto,
      getSecurityRequestContext(request),
    );
  }

  @Delete(':id')
  @RequirePermissions('dashboard:customize')
  delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() request: Request,
  ) {
    return this.dashboards.delete(
      user,
      id,
      getSecurityRequestContext(request),
    );
  }

  @Post(':id/apply-template')
  @RequirePermissions('dashboard:customize')
  applyTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ApplyTemplateDto,
    @Req() request: Request,
  ) {
    return this.dashboards.applyTemplate(
      user,
      id,
      dto,
      getSecurityRequestContext(request),
    );
  }
}
