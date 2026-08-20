import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { PaginationDto } from '../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuditService } from './audit.service';
@Controller('audit-events')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}
  @Get() @RequirePermissions('audit:view') list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationDto,
  ) {
    return this.audit.listForUser(user.id, query);
  }
}
