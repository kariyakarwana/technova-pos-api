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
import { CreditQueryDto, CreditRepaymentDto } from './dto/credit.dto';
import { CreditService } from './credit.service';
@Controller('credit')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CreditController {
  constructor(private readonly credit: CreditService) {}
  @Get('agreements') @RequirePermissions('credit:manage') list(
    @CurrentUser() u: AuthenticatedUser,
    @Query() q: CreditQueryDto,
  ) {
    return this.credit.list(u.id, q);
  }
  @Get('agreements/:id') @RequirePermissions('credit:manage') detail(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.credit.detail(u.id, id);
  }
  @Post('agreements/:id/payments') @RequirePermissions('credit:manage') repay(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
    @Body() d: CreditRepaymentDto,
    @Req() r: Request,
  ) {
    return this.credit.repay(u, id, d, getSecurityRequestContext(r));
  }
}
