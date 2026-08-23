import {
  Body,
  Controller,
  Get,
  Param,
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
import { CreateReturnDto, ReturnQueryDto } from './dto/return.dto';
import { ReturnsService } from './returns.service';
@Controller('returns')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReturnsController {
  constructor(private readonly returns: ReturnsService) {}
  @Get() @RequirePermissions('sales:view') list(
    @CurrentUser() u: AuthenticatedUser,
    @Query() q: ReturnQueryDto,
  ) {
    return this.returns.list(u.id, q);
  }
  @Get(':id') @RequirePermissions('sales:view') detail(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.returns.detail(u.id, id);
  }
  @Post() @RequirePermissions('returns:manage') create(
    @CurrentUser() u: AuthenticatedUser,
    @Body() d: CreateReturnDto,
    @Req() r: Request,
  ) {
    return this.returns.create(u, d, getSecurityRequestContext(r));
  }
}
