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
    return this.reports.inventory(u.id, q);
  }
  @Get('low-stock') lowStock(
    @CurrentUser() u: AuthenticatedUser,
    @Query() q: ReportFilterDto,
  ) {
    return this.reports.lowStock(u.id, q);
  }
  @Get('credit-aging') credit(@CurrentUser() u: AuthenticatedUser, @Query() q: ReportFilterDto) {
    return this.reports.creditAging(u.id, q);
  }
  @Get('purchases') purchases(@CurrentUser() u: AuthenticatedUser, @Query() q: ReportFilterDto) { return this.reports.purchases(u.id, q); }
  @Get('returns') returns(@CurrentUser() u: AuthenticatedUser, @Query() q: ReportFilterDto) { return this.reports.returns(u.id, q); }
  @Get('customers') customers(@CurrentUser() u: AuthenticatedUser, @Query() q: ReportFilterDto) { return this.reports.customers(u.id, q); }
  @Get('stock-movements') movements(@CurrentUser() u: AuthenticatedUser, @Query() q: ReportFilterDto) { return this.reports.stockMovements(u.id, q); }
  @Get('stock-transfers') transfers(@CurrentUser() u: AuthenticatedUser, @Query() q: ReportFilterDto) { return this.reports.stockTransfers(u.id, q); }
  @Get('warranties') warranties(@CurrentUser() u: AuthenticatedUser, @Query() q: ReportFilterDto) { return this.reports.warranties(u.id, q); }
  @Get('employees') employees(@CurrentUser() u: AuthenticatedUser, @Query() q: ReportFilterDto) { return this.reports.employees(u.id, q); }
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
    return this.reports.inventoryCsv(u.id, q);
  }
  @Get('low-stock.csv') async lowStockCsv(@CurrentUser() u: AuthenticatedUser, @Query() q: ReportFilterDto, @Res({ passthrough: true }) response: Response) {
    this.csvResponse(response, 'technova-low-stock-report.csv');
    return this.reports.lowStockCsv(u.id, q);
  }
  @Get('credit-aging.csv') async creditCsv(@CurrentUser() u: AuthenticatedUser, @Query() q: ReportFilterDto, @Res({ passthrough: true }) response: Response) {
    this.csvResponse(response, 'technova-credit-aging-report.csv');
    return this.reports.creditAgingCsv(u.id, q);
  }
  @Get('purchases.csv') async purchasesCsv(@CurrentUser() u: AuthenticatedUser, @Query() q: ReportFilterDto, @Res({ passthrough: true }) response: Response) { return this.filteredCsv(response, 'technova-purchases-report.csv', this.reports.purchasesCsv(u.id, q)); }
  @Get('returns.csv') async returnsCsv(@CurrentUser() u: AuthenticatedUser, @Query() q: ReportFilterDto, @Res({ passthrough: true }) response: Response) { return this.filteredCsv(response, 'technova-returns-report.csv', this.reports.returnsCsv(u.id, q)); }
  @Get('customers.csv') async customersCsv(@CurrentUser() u: AuthenticatedUser, @Query() q: ReportFilterDto, @Res({ passthrough: true }) response: Response) { return this.filteredCsv(response, 'technova-customers-report.csv', this.reports.customersCsv(u.id, q)); }
  @Get('stock-movements.csv') async movementsCsv(@CurrentUser() u: AuthenticatedUser, @Query() q: ReportFilterDto, @Res({ passthrough: true }) response: Response) { return this.filteredCsv(response, 'technova-stock-movements-report.csv', this.reports.stockMovementsCsv(u.id, q)); }
  @Get('stock-transfers.csv') async transfersCsv(@CurrentUser() u: AuthenticatedUser, @Query() q: ReportFilterDto, @Res({ passthrough: true }) response: Response) { return this.filteredCsv(response, 'technova-stock-transfers-report.csv', this.reports.stockTransfersCsv(u.id, q)); }
  @Get('warranties.csv') async warrantiesCsv(@CurrentUser() u: AuthenticatedUser, @Query() q: ReportFilterDto, @Res({ passthrough: true }) response: Response) { return this.filteredCsv(response, 'technova-warranties-report.csv', this.reports.warrantiesCsv(u.id, q)); }
  @Get('employees.csv') async employeesCsv(@CurrentUser() u: AuthenticatedUser, @Query() q: ReportFilterDto, @Res({ passthrough: true }) response: Response) { return this.filteredCsv(response, 'technova-employees-report.csv', this.reports.employeesCsv(u.id, q)); }
  private async filteredCsv(response: Response, filename: string, content: Promise<string>) {
    this.csvResponse(response, filename);
    return content;
  }
  private csvResponse(response: Response, filename: string) {
    response.type('text/csv');
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  }
}
