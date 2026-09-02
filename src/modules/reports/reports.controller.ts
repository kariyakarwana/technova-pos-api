import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { ReportFilterDto } from './dto/report.dto';
import { ReportsService } from './reports.service';
@Controller('reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('reports:view')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}
  @Get('dashboard') dashboard(
    @CurrentUser() u: AuthenticatedUser,
    @Query() q: ReportFilterDto,
  ) {
    return this.reports.dashboard(u.id, q);
  }
  @Get('sales') sales(
    @CurrentUser() u: AuthenticatedUser,
    @Query() q: ReportFilterDto,
  ) {
    return this.reports.sales(u.id, q);
  }
  @Get('inventory') inventory(
    @CurrentUser() u: AuthenticatedUser,
    @Query() q: ReportFilterDto,
  ) {
    return this.reports.inventory(u.id, q.branchId);
  }
  @Get('low-stock') lowStock(
    @CurrentUser() u: AuthenticatedUser,
    @Query() q: ReportFilterDto,
  ) {
    return this.reports.lowStock(u.id, q.branchId);
  }
  @Get('credit-aging') credit(@CurrentUser() u: AuthenticatedUser) {
    return this.reports.creditAging(u.id);
  }
  @Get('sales.csv') async csv(
    @CurrentUser() u: AuthenticatedUser,
    @Query() q: ReportFilterDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.type('text/csv');
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="technova-sales-report.csv"',
    );
    return this.reports.salesCsv(u.id, q);
  }
  @Get('inventory.csv') async inventoryCsv(@CurrentUser() u: AuthenticatedUser, @Query() q: ReportFilterDto, @Res({ passthrough: true }) response: Response) {
    this.csvResponse(response, 'technova-inventory-report.csv');
    return this.reports.inventoryCsv(u.id, q.branchId);
  }
  @Get('low-stock.csv') async lowStockCsv(@CurrentUser() u: AuthenticatedUser, @Query() q: ReportFilterDto, @Res({ passthrough: true }) response: Response) {
    this.csvResponse(response, 'technova-low-stock-report.csv');
    return this.reports.lowStockCsv(u.id, q.branchId);
  }
  @Get('credit-aging.csv') async creditCsv(@CurrentUser() u: AuthenticatedUser, @Res({ passthrough: true }) response: Response) {
    this.csvResponse(response, 'technova-credit-aging-report.csv');
    return this.reports.creditAgingCsv(u.id);
  }
  private csvResponse(response: Response, filename: string) {
    response.type('text/csv');
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  }
}
