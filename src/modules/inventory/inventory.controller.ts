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
import {
  AdjustmentDto,
  CreateTransferDto,
  DispatchTransferDto,
  InventoryQueryDto,
} from './dto/inventory.dto';
import { InventoryService } from './inventory.service';
@Controller('inventory')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}
  @Get('stock') @RequirePermissions('inventory:view') stock(
    @CurrentUser() u: AuthenticatedUser,
    @Query() q: InventoryQueryDto,
  ) {
    return this.inventory.stock(u.id, q);
  }
  @Get('movements') @RequirePermissions('inventory:view') movements(
    @CurrentUser() u: AuthenticatedUser,
    @Query() q: InventoryQueryDto,
  ) {
    return this.inventory.movements(u.id, q);
  }
  @Post('adjustments') @RequirePermissions('inventory:manage') adjust(
    @CurrentUser() u: AuthenticatedUser,
    @Body() d: AdjustmentDto,
    @Req() r: Request,
  ) {
    return this.inventory.adjust(u, d, getSecurityRequestContext(r));
  }
  @Post('transfers') @RequirePermissions('inventory:manage') create(
    @CurrentUser() u: AuthenticatedUser,
    @Body() d: CreateTransferDto,
    @Req() r: Request,
  ) {
    return this.inventory.createTransfer(u, d, getSecurityRequestContext(r));
  }
  @Get('transfers') @RequirePermissions('inventory:view') transfers(
    @CurrentUser() u: AuthenticatedUser,
    @Query() q: InventoryQueryDto,
  ) {
    return this.inventory.transfers(u.id, q);
  }
  @Get('units') @RequirePermissions('inventory:view') units(
    @CurrentUser() u: AuthenticatedUser,
    @Query() q: InventoryQueryDto,
  ) {
    return this.inventory.units(u.id, q);
  }
  @Get('units/:id') @RequirePermissions('inventory:view') unit(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.inventory.unit(u.id, id);
  }
  @Get('transfers/:id') @RequirePermissions('inventory:view') transfer(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.inventory.transfer(u.id, id);
  }
  @Post('transfers/:id/dispatch')
  @RequirePermissions('inventory:manage')
  dispatch(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
    @Body() d: DispatchTransferDto,
    @Req() r: Request,
  ) {
    return this.inventory.dispatch(u, id, d, getSecurityRequestContext(r));
  }
  @Post('transfers/:id/receive')
  @RequirePermissions('inventory:manage')
  receive(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
    @Req() r: Request,
  ) {
    return this.inventory.receive(u, id, getSecurityRequestContext(r));
  }
}
