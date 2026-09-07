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
import {
  CreateVisualThemeDto,
  UpdateVisualThemeDto,
  VisualThemeQueryDto,
} from './dto/visual-theme.dto';
import { VisualThemesService } from './visual-themes.service';

@Controller('visual-themes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class VisualThemesController {
  constructor(private readonly visualThemes: VisualThemesService) {}

  @Get()
  @RequirePermissions('dashboard:view')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: VisualThemeQueryDto,
  ) {
    return this.visualThemes.list(user, query);
  }

  @Get(':id')
  @RequirePermissions('dashboard:view')
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.visualThemes.detail(user, id);
  }

  @Post()
  @RequirePermissions('dashboard:manage_themes')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateVisualThemeDto,
    @Req() request: Request,
  ) {
    return this.visualThemes.create(
      user,
      dto,
      getSecurityRequestContext(request),
    );
  }

  @Patch(':id')
  @RequirePermissions('dashboard:manage_themes')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateVisualThemeDto,
    @Req() request: Request,
  ) {
    return this.visualThemes.update(
      user,
      id,
      dto,
      getSecurityRequestContext(request),
    );
  }

  @Post(':id/set-default')
  @RequirePermissions('dashboard:manage_themes')
  setDefault(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() request: Request,
  ) {
    return this.visualThemes.setDefault(
      user,
      id,
      getSecurityRequestContext(request),
    );
  }

  @Delete(':id')
  @RequirePermissions('dashboard:manage_themes')
  delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() request: Request,
  ) {
    return this.visualThemes.delete(
      user,
      id,
      getSecurityRequestContext(request),
    );
  }
}
