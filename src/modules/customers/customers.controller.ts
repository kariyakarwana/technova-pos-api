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
import { getSecurityRequestContext } from '../../common/security/request';
import {
  CreateCustomerDto,
  CustomerQueryDto,
  UpdateCustomerDto,
} from './dto/customer.dto';
import { CustomersService } from './customers.service';
@Controller('customers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}
  @Get() @RequirePermissions('customers:view') list(
    @CurrentUser() u: AuthenticatedUser,
    @Query() q: CustomerQueryDto,
  ) {
    return this.customers.list(u.id, q);
  }
  @Get(':id') @RequirePermissions('customers:view') detail(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.customers.detail(u.id, id);
  }
  @Post() @RequirePermissions('customers:manage') create(
    @CurrentUser() u: AuthenticatedUser,
    @Body() d: CreateCustomerDto,
    @Req() r: Request,
  ) {
    return this.customers.create(u, d, getSecurityRequestContext(r));
  }
  @Patch(':id') @RequirePermissions('customers:manage') update(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
    @Body() d: UpdateCustomerDto,
    @Req() r: Request,
  ) {
    return this.customers.update(u, id, d, getSecurityRequestContext(r));
  }
}
