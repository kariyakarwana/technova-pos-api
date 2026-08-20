import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { getSecurityRequestContext } from '../../common/security/request';
import { UpdateOrganizationDto } from './dto/organization.dto';
import { OrganizationsService } from './organizations.service';

@Controller('organization')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  @RequirePermissions('settings:view')
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.organizations.getForUser(user.id);
  }

  @Patch()
  @RequirePermissions('settings:manage')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateOrganizationDto,
    @Req() request: Request,
  ) {
    return this.organizations.updateForUser(
      user,
      dto,
      getSecurityRequestContext(request),
    );
  }
}
