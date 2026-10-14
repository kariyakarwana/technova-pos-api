import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { PurchaseOrderStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import type { SecurityRequestContext } from '../../common/security/request';
import type { PrismaService } from '../../database/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { SupplierPortalService } from '../suppliers/supplier-portal.service';
import { PurchasingService } from './purchasing.service';

describe('PurchasingService supplier invoice selection', () => {
  const actor = { id: 'employee-1' } as AuthenticatedUser;
  const context = {} as SecurityRequestContext;
  const order = {
    id: 'order-1',
    branchId: 'branch-1',
    branch: { organizationId: 'org-1' },
    supplierId: 'supplier-1',
    status: PurchaseOrderStatus.APPROVED,
    items: [],
    supplierInvoices: [{ id: 'invoice-1', invoiceNumber: 'SUP-1001' }],
  };

  function setup() {
    const tx = {
      goodsReceipt: {
        create: jest
          .fn()
          .mockResolvedValue({ id: 'receipt-1', receiptNumber: 'GRN-1' }),
      },
      purchaseOrderItem: { findMany: jest.fn().mockResolvedValue([]) },
      purchaseOrder: { update: jest.fn().mockResolvedValue({}) },
      supplierShipment: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      appNotification: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new PurchasingService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      {} as ConfigService,
      {} as SupplierPortalService,
    );
    jest.spyOn(service, 'detail').mockResolvedValue(order as never);
    return { service, prisma, tx };
  }

  it('uses the number from an uploaded invoice rather than a client-supplied number', async () => {
    const { service, tx } = setup();
    await service.receive(
      actor,
      order.id,
      {
        receiptNumber: 'GRN-1',
        supplierInvoiceId: 'invoice-1',
        supplierInvoiceNumber: 'TAMPERED',
        items: [],
      },
      context,
    );
    expect(tx.goodsReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ supplierInvoiceNumber: 'SUP-1001' }),
    });
    expect(tx.appNotification.updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        supplierId: 'supplier-1',
        actionUrl: '/purchases/order-1',
        eventType: { in: [
          'SUPPLIER_ORDER_RESPONSE',
          'SUPPLIER_ORDER_DISPATCHED',
          'SUPPLIER_INVOICE_UPLOADED',
        ] },
        readAt: null,
      },
      data: { readAt: expect.any(Date) },
    });
  });

  it('rejects an invoice from another purchase order before increasing stock', async () => {
    const { service, prisma } = setup();
    await expect(
      service.receive(
        actor,
        order.id,
        {
          receiptNumber: 'GRN-1',
          supplierInvoiceId: 'other-invoice',
          items: [],
        },
        context,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('keeps staff order alerts active after a partial receipt', async () => {
    const { service, tx } = setup();
    tx.purchaseOrderItem.findMany.mockResolvedValueOnce([{ quantity: 2, receivedQuantity: 1 }] as never);

    await service.receive(actor, order.id, { receiptNumber: 'GRN-2', items: [] }, context);

    expect(tx.appNotification.updateMany).not.toHaveBeenCalled();
  });
});
