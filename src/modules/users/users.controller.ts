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

import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { getSecurityRequestContext } from '../../common/security/request';
import { CreateUserDto, UpdateUserAccessDto, UserQueryDto } from './dto/user.dto';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}
  @Get()
  @RequirePermissions('users:manage')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: UserQueryDto) {
    return this.users.list(user.id, query);
  }
  @Post()
  @RequirePermissions('users:manage')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateUserDto,
    @Req() req: Request,
  ) {
    return this.users.create(user, dto, getSecurityRequestContext(req));
  }
  @Patch(':id/access')
  @RequirePermissions('users:manage')
  updateAccess(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserAccessDto,
    @Req() req: Request,
  ) {
    return this.users.updateAccess(
      user,
      id,
      dto,
      getSecurityRequestContext(req),
    );
  }
  @Delete(':id')
  @RequirePermissions('users:manage')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.users.remove(user, id, getSecurityRequestContext(req));
  }
}
