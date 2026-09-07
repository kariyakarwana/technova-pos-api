import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { getSecurityRequestContext } from '../../common/security/request';
import {
  DispatchSupplierOrderDto,
  RespondToPurchaseOrderDto,
  ReviewSupplierResponseDto,
  SupplierPortalOrderQueryDto,
  SupplierPortalPreferencesDto,
  UploadSupplierInvoiceDto,
} from './dto/supplier-portal.dto';
import { SupplierPortalService } from './supplier-portal.service';

@Controller('supplier-portal')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SupplierPortalController {
  constructor(private readonly portal: SupplierPortalService) {}

  @Get('dashboard')
  dashboard(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SupplierPortalOrderQueryDto,
  ) {
    return this.portal.dashboard(user.id, query);
  }

  @Get('orders/:id')
  order(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.portal.order(user.id, id);
  }

  @Post('orders/:id/respond')
  respond(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RespondToPurchaseOrderDto,
    @Req() request: Request,
  ) {
    return this.portal.respond(user, id, dto, getSecurityRequestContext(request));
  }

  @Post('responses/:id/review')
  @RequirePermissions('purchases:manage')
  review(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReviewSupplierResponseDto,
    @Req() request: Request,
  ) {
    return this.portal.review(user, id, dto, getSecurityRequestContext(request));
  }

  @Post('orders/:id/dispatch')
  dispatch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DispatchSupplierOrderDto,
    @Req() request: Request,
  ) {
    return this.portal.dispatch(user, id, dto, getSecurityRequestContext(request));
  }

  @Post('orders/:id/invoices')
  invoice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UploadSupplierInvoiceDto,
    @Req() request: Request,
  ) {
    return this.portal.uploadInvoice(user, id, dto, getSecurityRequestContext(request));
  }

  @Get('invoices/:id/file')
  async invoiceFile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Res() response: Response,
  ) {
    const invoice = await this.portal.invoiceFile(user, id);
    response.setHeader('Content-Type', invoice.mimeType);
    response.setHeader(
      'Content-Disposition',
      `inline; filename="${invoice.fileName.replace(/["\\\r\n]/g, '_')}"`,
    );
    response.setHeader('Content-Length', invoice.fileSize);
    response.send(Buffer.from(invoice.fileData));
  }

  @Patch('preferences')
  preferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SupplierPortalPreferencesDto,
  ) {
    return this.portal.preferences(user.id, dto);
  }
}
