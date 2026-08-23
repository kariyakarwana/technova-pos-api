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
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { getSecurityRequestContext } from '../../common/security/request';
import {
  CreateWarrantyPolicyDto,
  UpdateWarrantyPolicyDto,
} from './dto/warranty.dto';
import { WarrantiesService } from './warranties.service';
@Controller('warranties')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class WarrantiesController {
  constructor(private readonly warranties: WarrantiesService) {}
  @Get('policies') @RequirePermissions('warranties:manage') policies(
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.warranties.policies(u.id);
  }
  @Post('policies') @RequirePermissions('warranties:manage') create(
    @CurrentUser() u: AuthenticatedUser,
    @Body() d: CreateWarrantyPolicyDto,
    @Req() r: Request,
  ) {
    return this.warranties.createPolicy(u, d, getSecurityRequestContext(r));
  }
  @Patch('policies/:id') @RequirePermissions('warranties:manage') update(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
    @Body() d: UpdateWarrantyPolicyDto,
    @Req() r: Request,
  ) {
    return this.warranties.updatePolicy(u, id, d, getSecurityRequestContext(r));
  }
}
