import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';

import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { getSecurityRequestContext } from '../../common/security/request';
import { UpdateOrganizationDto } from './dto/organization.dto';
import { OrganizationsService } from './organizations.service';
import type { ProductUpload } from '../storage/storage.service';

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

  @Post('logo')
  @RequirePermissions('settings:manage')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  uploadLogo(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: ProductUpload | undefined,
    @Req() request: Request,
  ) {
    return this.organizations.uploadLogo(
      user,
      file,
      getSecurityRequestContext(request),
    );
  }

  @Delete('logo')
  @RequirePermissions('settings:manage')
  removeLogo(@CurrentUser() user: AuthenticatedUser, @Req() request: Request) {
    return this.organizations.removeLogo(
      user,
      getSecurityRequestContext(request),
    );
  }
}
