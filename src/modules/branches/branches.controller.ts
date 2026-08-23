import {
  Body,
  Controller,
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
import { PaginationDto } from '../../common/dto/pagination.dto';
import { getSecurityRequestContext } from '../../common/security/request';
import { BranchesService } from './branches.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';

@Controller('branches')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  @RequirePermissions('branches:view')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationDto) {
    return this.branches.list(user.id, query);
  }

  @Post()
  @RequirePermissions('branches:manage')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBranchDto,
    @Req() request: Request,
  ) {
    return this.branches.create(user, dto, getSecurityRequestContext(request));
  }

  @Patch(':id')
  @RequirePermissions('branches:manage')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateBranchDto,
    @Req() request: Request,
  ) {
    return this.branches.update(
      user,
      id,
      dto,
      getSecurityRequestContext(request),
    );
  }
}
