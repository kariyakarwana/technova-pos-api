import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
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
import { DashboardTemplatesService } from './dashboard-templates.service';
import {
  CreateDashboardTemplateDto,
  DashboardTemplateQueryDto,
  UpdateDashboardTemplateDto,
} from './dto/dashboard-template.dto';

@Controller('dashboard-templates')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DashboardTemplatesController {
  constructor(
    private readonly dashboardTemplates: DashboardTemplatesService,
  ) {}

  @Get()
  @RequirePermissions('dashboard:view')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DashboardTemplateQueryDto,
  ) {
    return this.dashboardTemplates.list(user, query);
  }

  @Get(':id')
  @RequirePermissions('dashboard:view')
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.dashboardTemplates.detail(user, id);
  }

  @Post()
  @RequirePermissions('dashboard:manage_templates')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDashboardTemplateDto,
    @Req() request: Request,
  ) {
    return this.dashboardTemplates.create(
      user,
      dto,
      getSecurityRequestContext(request),
    );
  }

  @Patch(':id')
  @RequirePermissions('dashboard:manage_templates')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateDashboardTemplateDto,
    @Req() request: Request,
  ) {
    return this.dashboardTemplates.update(
      user,
      id,
      dto,
      getSecurityRequestContext(request),
    );
  }

  @Delete(':id')
  @RequirePermissions('dashboard:manage_templates')
  delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() request: Request,
  ) {
    return this.dashboardTemplates.delete(
      user,
      id,
      getSecurityRequestContext(request),
    );
  }
}
