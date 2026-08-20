import {
  Body,
  Controller,
  Get,
  Param,
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
import { OfflineSyncBatchDto } from './dto/offline-sync.dto';
import { OfflineSyncService } from './offline-sync.service';
@Controller('offline-sync')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('sales:manage')
export class OfflineSyncController {
  constructor(private readonly sync: OfflineSyncService) {}
  @Post('batches') submit(
    @CurrentUser() u: AuthenticatedUser,
    @Body() d: OfflineSyncBatchDto,
    @Req() r: Request,
  ) {
    return this.sync.submit(u, d, getSecurityRequestContext(r));
  }
  @Get('batches/:id') status(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.sync.status(u.id, id);
  }
  @Get('client-batches/:clientBatchId') byClient(
    @CurrentUser() u: AuthenticatedUser,
    @Param('clientBatchId') id: string,
  ) {
    return this.sync.byClientId(u.id, id);
  }
}
