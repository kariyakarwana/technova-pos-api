import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import type { SecurityRequestContext } from '../../common/security/request';
import type { PrismaService } from '../../database/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { SupplierPortalService } from './supplier-portal.service';

describe('SupplierPortalService invoice upload', () => {
  it('marks only the matching supplier order notification read after invoice and dispatch', async () => {
    const saved = {
      id: 'invoice-1',
      invoiceNumber: 'SUP-1001',
      fileName: 'invoice.pdf',
      mimeType: 'application/pdf',
      fileSize: 4,
      uploadedAt: new Date(),
    };
    const tx = {
      supplierInvoice: { create: jest.fn().mockResolvedValue(saved) },
      appNotification: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      purchaseOrder: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'order-1',
          orderNumber: 'PO-1',
          supplierResponses: [{ status: 'ACCEPTED' }],
          supplierShipments: [{ id: 'shipment-1' }],
        }),
      },
      $transaction: jest.fn((callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new SupplierPortalService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
    jest.spyOn(service as never, 'membership').mockResolvedValue({
      supplierId: 'supplier-1',
      supplier: { name: 'Supplier', organizationId: 'org-1' },
    } as never);
    jest
      .spyOn(service as never, 'notifyInternal')
      .mockResolvedValue(undefined as never);

    await service.uploadInvoice(
      { id: 'supplier-user-1' } as AuthenticatedUser,
      'order-1',
      {
        invoiceNumber: 'SUP-1001',
        fileName: 'invoice.pdf',
        mimeType: 'application/pdf',
        base64Data: 'dGVzdA==',
      },
      {} as SecurityRequestContext,
    );

    expect(tx.appNotification.updateMany).toHaveBeenCalledWith({
      where: {
        supplierId: 'supplier-1',
        eventType: 'PURCHASE_ORDER_ISSUED_TO_SUPPLIER',
        actionUrl: '/supplier-dashboard/orders/order-1',
        readAt: null,
      },
      data: { readAt: expect.any(Date) },
    });
    expect(tx.supplierInvoice.create).toHaveBeenCalledTimes(1);
  });

  it('keeps the order notification active when the invoice is uploaded before dispatch', async () => {
    const tx = {
      supplierInvoice: { create: jest.fn().mockResolvedValue({ id: 'invoice-1', invoiceNumber: 'SUP-1001' }) },
      appNotification: { updateMany: jest.fn() },
    };
    const prisma = {
      purchaseOrder: { findFirst: jest.fn().mockResolvedValue({
        id: 'order-1', orderNumber: 'PO-1', supplierResponses: [{ status: 'ACCEPTED' }], supplierShipments: [],
      }) },
      $transaction: jest.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const service = new SupplierPortalService(
      prisma as unknown as PrismaService,
      { record: jest.fn() } as unknown as AuditService,
    );
    jest.spyOn(service as never, 'membership').mockResolvedValue({
      supplierId: 'supplier-1', supplier: { name: 'Supplier', organizationId: 'org-1' },
    } as never);
    jest.spyOn(service as never, 'notifyInternal').mockResolvedValue(undefined as never);

    await service.uploadInvoice(
      { id: 'supplier-user-1' } as AuthenticatedUser,
      'order-1',
      { invoiceNumber: 'SUP-1001', fileName: 'invoice.pdf', mimeType: 'application/pdf', base64Data: 'dGVzdA==' },
      {} as SecurityRequestContext,
    );

    expect(tx.appNotification.updateMany).not.toHaveBeenCalled();
  });

  it('marks the order notification read when dispatch follows an invoice', async () => {
    const prisma = {
      purchaseOrder: { findFirst: jest.fn().mockResolvedValue({
        id: 'order-1', orderNumber: 'PO-1', status: 'APPROVED',
        supplierResponses: [{ status: 'ACCEPTED' }], supplierInvoices: [{ id: 'invoice-1' }],
      }) },
      supplierShipment: { create: jest.fn().mockResolvedValue({ id: 'shipment-1' }) },
      appNotification: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const service = new SupplierPortalService(
      prisma as unknown as PrismaService,
      { record: jest.fn() } as unknown as AuditService,
    );
    jest.spyOn(service as never, 'membership').mockResolvedValue({
      supplierId: 'supplier-1', supplier: { name: 'Supplier', organizationId: 'org-1' },
    } as never);
    jest.spyOn(service as never, 'notifyInternal').mockResolvedValue(undefined as never);

    await service.dispatch(
      { id: 'supplier-user-1' } as AuthenticatedUser,
      'order-1',
      { carrier: 'Courier' },
      {} as SecurityRequestContext,
    );

    expect(prisma.appNotification.updateMany).toHaveBeenCalledWith({
      where: {
        supplierId: 'supplier-1',
        actionUrl: '/supplier-dashboard/orders/order-1',
        eventType: { in: ['PURCHASE_ORDER_ISSUED_TO_SUPPLIER', 'SUPPLIER_RESPONSE_REVIEWED'] },
        readAt: null,
      },
      data: { readAt: expect.any(Date) },
    });
  });
});
