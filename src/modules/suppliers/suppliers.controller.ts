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
import { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';
import { SuppliersService } from './suppliers.service';
@Controller('suppliers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}
  @Get() @RequirePermissions('suppliers:view') list(
    @CurrentUser() u: AuthenticatedUser,
    @Query() q: PaginationDto,
  ) {
    return this.suppliers.list(u.id, q);
  }
  @Get(':id') @RequirePermissions('suppliers:view') detail(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.suppliers.detail(u.id, id);
  }
  @Post() @RequirePermissions('suppliers:manage') create(
    @CurrentUser() u: AuthenticatedUser,
    @Body() d: CreateSupplierDto,
    @Req() r: Request,
  ) {
    return this.suppliers.create(u, d, getSecurityRequestContext(r));
  }
  @Patch(':id') @RequirePermissions('suppliers:manage') update(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
    @Body() d: UpdateSupplierDto,
    @Req() r: Request,
  ) {
    return this.suppliers.update(u, id, d, getSecurityRequestContext(r));
  }
}
