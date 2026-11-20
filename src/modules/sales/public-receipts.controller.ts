import { Controller, Get, Param, Query } from '@nestjs/common';
import { SalesService } from './sales.service';

/**
 * Public controller for digital receipts.
 * Accessible by end customers without login credentials.
 * Secured by UUID + Cryptographic HMAC Token verification.
 */
@Controller('receipts')
export class PublicReceiptsController {
  constructor(private readonly sales: SalesService) {}

  @Get(':receiptId')
  getPublicReceipt(
    @Param('receiptId') receiptId: string,
    @Query('token') token: string,
  ) {
    return this.sales.getPublicReceipt(receiptId, token);
  }
}
