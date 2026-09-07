import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NotificationChannel,
  Prisma,
  PurchaseOrderStatus,
  SupplierResponseReviewStatus,
  SupplierResponseStatus,
  SupplierShipmentStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { paginate } from '../../common/dto/pagination.dto';
import type { SecurityRequestContext } from '../../common/security/request';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  DispatchSupplierOrderDto,
  RespondToPurchaseOrderDto,
  ReviewSupplierResponseDto,
  SupplierPortalOrderQueryDto,
  SupplierPortalPreferencesDto,
  UploadSupplierInvoiceDto,
} from './dto/supplier-portal.dto';

@Injectable()
export class SupplierPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async membership(userId: string) {
    const membership = await this.prisma.supplierUser.findUnique({
      where: { userId },
      include: { supplier: { include: { organization: true } } },
    });
    if (
      !membership ||
      !membership.supplier.portalEnabled ||
      membership.supplier.status !== 'ACTIVE'
    )
      throw new ForbiddenException('Supplier portal access is not enabled.');
    if (!membership.supplier.organization.supplierPortalEnabled)
      throw new ForbiddenException(
        'The supplier portal is disabled for this organization.',
      );
    return membership;
  }

  async dashboard(userId: string, query: SupplierPortalOrderQueryDto) {
    const membership = await this.membership(userId);
    const supplierId = membership.supplierId;
    const where: Prisma.PurchaseOrderWhereInput = {
      supplierId,
      status: query.status
        ? (query.status as PurchaseOrderStatus)
        : { notIn: [PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.SUBMITTED] },
      createdAt:
        query.from || query.to
          ? {
              gte: query.from ? new Date(query.from) : undefined,
              lte: query.to ? new Date(query.to) : undefined,
            }
          : undefined,
      OR: query.search
        ? [
            { orderNumber: { contains: query.search, mode: 'insensitive' } },
            { branch: { name: { contains: query.search, mode: 'insensitive' } } },
          ]
        : undefined,
    };
    const [data, total, pending, inTransit, completedThisMonth, unread] =
      await this.prisma.$transaction([
        this.prisma.purchaseOrder.findMany({
          where,
          skip: query.skip,
          take: query.pageSize,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            orderNumber: true,
            status: true,
            total: true,
            expectedAt: true,
            createdAt: true,
            branch: { select: { id: true, code: true, name: true } },
            supplierResponses: {
              take: 1,
              orderBy: { respondedAt: 'desc' },
              select: { status: true, reviewStatus: true, respondedAt: true },
            },
            supplierShipments: {
              take: 1,
              orderBy: { createdAt: 'desc' },
              select: { id: true, status: true, dispatchedAt: true },
            },
            _count: { select: { items: true, supplierInvoices: true } },
          },
        }),
        this.prisma.purchaseOrder.count({ where }),
        this.prisma.purchaseOrder.count({
          where: {
            supplierId,
            status: PurchaseOrderStatus.APPROVED,
            supplierResponses: { none: {} },
          },
        }),
        this.prisma.supplierShipment.count({
          where: { purchaseOrder: { supplierId }, status: SupplierShipmentStatus.DISPATCHED },
        }),
        this.prisma.purchaseOrder.count({
          where: {
            supplierId,
            status: PurchaseOrderStatus.RECEIVED,
            updatedAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
          },
        }),
        this.prisma.appNotification.count({
          where: { recipientUserId: userId, readAt: null },
        }),
      ]);
    return {
      supplier: {
        id: membership.supplier.id,
        name: membership.supplier.name,
        code: membership.supplier.code,
        allowOrderChanges: this.orderChangesEnabled(membership.supplier),
        emailNotificationsEnabled: this.emailEnabled(membership.supplier),
        inAppNotificationsEnabled: this.inAppEnabled(membership.supplier),
      },
      stats: { pending, inTransit, completedThisMonth, unread },
      orders: paginate(data, total, query),
    };
  }

  async order(userId: string, id: string) {
    const membership = await this.membership(userId);
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id, supplierId: membership.supplierId },
      include: {
        branch: true,
        items: { include: { product: { select: { id: true, sku: true, name: true } } } },
        supplierResponses: {
          orderBy: { respondedAt: 'desc' },
          include: { lines: true },
        },
        supplierShipments: { orderBy: { createdAt: 'desc' } },
        supplierInvoices: {
          orderBy: { uploadedAt: 'desc' },
          select: {
            id: true,
            shipmentId: true,
            invoiceNumber: true,
            fileName: true,
            mimeType: true,
            fileSize: true,
            uploadedAt: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Purchase order not found.');
    return {
      ...order,
      allowOrderChanges: this.orderChangesEnabled(membership.supplier),
    };
  }

  async respond(
    actor: AuthenticatedUser,
    id: string,
    dto: RespondToPurchaseOrderDto,
    context: SecurityRequestContext,
  ) {
    const membership = await this.membership(actor.id);
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id, supplierId: membership.supplierId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Purchase order not found.');
    if (order.status !== PurchaseOrderStatus.APPROVED)
      throw new ConflictException('Only approved purchase orders can be answered.');
    if (
      dto.status === SupplierResponseStatus.CHANGES_PROPOSED &&
      !this.orderChangesEnabled(membership.supplier)
    )
      throw new ForbiddenException('Order change proposals are disabled.');
    const lines = dto.lines ?? [];
    if (dto.status === SupplierResponseStatus.CHANGES_PROPOSED && !lines.length)
      throw new BadRequestException('Add at least one proposed line change.');
    const itemIds = new Set(order.items.map(({ id: itemId }) => itemId));
    if (lines.some(({ purchaseOrderItemId }) => !itemIds.has(purchaseOrderItemId)))
      throw new BadRequestException('A proposed line does not belong to this order.');
    if (new Set(lines.map(({ purchaseOrderItemId }) => purchaseOrderItemId)).size !== lines.length)
      throw new BadRequestException('A proposed line is duplicated.');
    const response = await this.prisma.supplierOrderResponse.create({
      data: {
        purchaseOrderId: id,
        respondedById: actor.id,
        status: dto.status,
        reviewStatus:
          dto.status === SupplierResponseStatus.CHANGES_PROPOSED
            ? SupplierResponseReviewStatus.PENDING
            : SupplierResponseReviewStatus.NOT_REQUIRED,
        notes: dto.notes,
        proposedExpectedAt: dto.proposedExpectedAt
          ? new Date(dto.proposedExpectedAt)
          : undefined,
        lines: { create: lines },
      },
      include: { lines: true },
    });
    await this.notifyInternal(
      membership.supplier.organizationId,
      membership.supplierId,
      'SUPPLIER_ORDER_RESPONSE',
      `${membership.supplier.name} responded to ${order.orderNumber}`,
      dto.status.replaceAll('_', ' ').toLowerCase(),
      `/purchases/${id}`,
    );
    await this.audit.record({
      userId: actor.id,
      action: 'SUPPLIER_ORDER_RESPONSE_SUBMITTED',
      context,
      metadata: { purchaseOrderId: id, responseId: response.id, status: dto.status },
    });
    return response;
  }

  async review(
    actor: AuthenticatedUser,
    responseId: string,
    dto: ReviewSupplierResponseDto,
    context: SecurityRequestContext,
  ) {
    const organizationId = await this.organizationId(actor.id);
    const response = await this.prisma.supplierOrderResponse.findFirst({
      where: {
        id: responseId,
        purchaseOrder: { branch: { organizationId } },
      },
      include: {
        lines: true,
        purchaseOrder: {
          include: { items: true, supplier: { include: { organization: true } } },
        },
      },
    });
    if (!response) throw new NotFoundException('Supplier response not found.');
    if (
      response.status !== SupplierResponseStatus.CHANGES_PROPOSED ||
      response.reviewStatus !== SupplierResponseReviewStatus.PENDING
    )
      throw new ConflictException('This response does not need a review.');
    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.approved) {
        for (const line of response.lines) {
          await tx.purchaseOrderItem.update({
            where: { id: line.purchaseOrderItemId },
            data: {
              quantity: line.proposedQuantity ?? undefined,
              unitCost: line.proposedUnitCost ?? undefined,
            },
          });
        }
        const items = await tx.purchaseOrderItem.findMany({
          where: { purchaseOrderId: response.purchaseOrderId },
        });
        let subtotal = 0;
        let discountTotal = 0;
        let taxTotal = 0;
        for (const item of items) {
          const lineTotal =
            Number(item.quantity) * Number(item.unitCost) -
            Number(item.discount) +
            Number(item.tax);
          subtotal += Number(item.quantity) * Number(item.unitCost);
          discountTotal += Number(item.discount);
          taxTotal += Number(item.tax);
          await tx.purchaseOrderItem.update({
            where: { id: item.id },
            data: { lineTotal },
          });
        }
        await tx.purchaseOrder.update({
          where: { id: response.purchaseOrderId },
          data: {
            expectedAt: response.proposedExpectedAt ?? undefined,
            subtotal,
            discountTotal,
            taxTotal,
            total: subtotal - discountTotal + taxTotal,
          },
        });
      }
      return tx.supplierOrderResponse.update({
        where: { id: responseId },
        data: {
          reviewStatus: dto.approved
            ? SupplierResponseReviewStatus.APPROVED
            : SupplierResponseReviewStatus.REJECTED,
          reviewedById: actor.id,
          reviewedAt: new Date(),
          notes: dto.notes
            ? [response.notes, `Internal review: ${dto.notes}`].filter(Boolean).join('\n')
            : response.notes,
        },
      });
    });
    await this.notifySupplier(
      response.purchaseOrder.supplier,
      'SUPPLIER_RESPONSE_REVIEWED',
      `Response reviewed for ${response.purchaseOrder.orderNumber}`,
      dto.approved ? 'Your proposed changes were approved.' : 'Your proposed changes were not approved.',
      `/supplier-dashboard/orders/${response.purchaseOrderId}`,
    );
    await this.audit.record({
      userId: actor.id,
      action: 'SUPPLIER_ORDER_RESPONSE_REVIEWED',
      context,
      metadata: { purchaseOrderId: response.purchaseOrderId, responseId, approved: dto.approved },
    });
    return updated;
  }

  async dispatch(
    actor: AuthenticatedUser,
    orderId: string,
    dto: DispatchSupplierOrderDto,
    context: SecurityRequestContext,
  ) {
    const membership = await this.membership(actor.id);
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id: orderId, supplierId: membership.supplierId },
      include: { supplierResponses: { orderBy: { respondedAt: 'desc' }, take: 1 } },
    });
    if (!order) throw new NotFoundException('Purchase order not found.');
    const response = order.supplierResponses[0];
    const accepted =
      response?.status === SupplierResponseStatus.ACCEPTED ||
      (response?.status === SupplierResponseStatus.CHANGES_PROPOSED &&
        response.reviewStatus === SupplierResponseReviewStatus.APPROVED);
    if (!accepted)
      throw new ConflictException('Accept the order or obtain approval for proposed changes before dispatch.');
    if (order.status !== PurchaseOrderStatus.APPROVED)
      throw new ConflictException('This purchase order cannot be dispatched.');
    const status = dto.status ?? SupplierShipmentStatus.DISPATCHED;
    const shipment = await this.prisma.supplierShipment.create({
      data: {
        purchaseOrderId: orderId,
        dispatchedById: actor.id,
        status,
        carrier: dto.carrier,
        trackingNumber: dto.trackingNumber,
        notes: dto.notes,
        expectedArrival: dto.expectedArrival ? new Date(dto.expectedArrival) : undefined,
        dispatchedAt: status === SupplierShipmentStatus.DISPATCHED ? new Date() : undefined,
      },
    });
    await this.notifyInternal(
      membership.supplier.organizationId,
      membership.supplierId,
      'SUPPLIER_ORDER_DISPATCHED',
      `${membership.supplier.name} dispatched ${order.orderNumber}`,
      dto.trackingNumber ? `Tracking: ${dto.trackingNumber}` : 'Shipment is on its way.',
      `/purchases/${orderId}`,
    );
    await this.audit.record({
      userId: actor.id,
      action: 'SUPPLIER_ORDER_DISPATCHED',
      context,
      metadata: { purchaseOrderId: orderId, shipmentId: shipment.id },
    });
    return shipment;
  }

  async uploadInvoice(
    actor: AuthenticatedUser,
    orderId: string,
    dto: UploadSupplierInvoiceDto,
    context: SecurityRequestContext,
  ) {
    const membership = await this.membership(actor.id);
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id: orderId, supplierId: membership.supplierId },
      include: {
        supplierResponses: { orderBy: { respondedAt: 'desc' }, take: 1 },
      },
    });
    if (!order) throw new NotFoundException('Purchase order not found.');
    const latestResponse = order.supplierResponses[0];
    const accepted =
      latestResponse?.status === SupplierResponseStatus.ACCEPTED ||
      (latestResponse?.status === SupplierResponseStatus.CHANGES_PROPOSED &&
        latestResponse.reviewStatus === SupplierResponseReviewStatus.APPROVED);
    if (!accepted)
      throw new ConflictException(
        'Accept the order or obtain approval for proposed changes before uploading an invoice.',
      );
    const fileData = Buffer.from(dto.base64Data, 'base64');
    if (!fileData.length || fileData.length > 5 * 1024 * 1024)
      throw new BadRequestException('Invoice files must be between 1 byte and 5 MB.');
    if (dto.shipmentId) {
      const validShipment = await this.prisma.supplierShipment.count({
        where: { id: dto.shipmentId, purchaseOrderId: orderId },
      });
      if (!validShipment) throw new BadRequestException('Shipment is invalid.');
    }
    const invoice = await this.prisma.supplierInvoice.create({
      data: {
        purchaseOrderId: orderId,
        shipmentId: dto.shipmentId,
        invoiceNumber: dto.invoiceNumber.trim(),
        fileName: dto.fileName,
        mimeType: dto.mimeType,
        fileSize: fileData.length,
        fileData,
      },
      select: {
        id: true,
        invoiceNumber: true,
        fileName: true,
        mimeType: true,
        fileSize: true,
        uploadedAt: true,
      },
    });
    await this.notifyInternal(
      membership.supplier.organizationId,
      membership.supplierId,
      'SUPPLIER_INVOICE_UPLOADED',
      `Invoice uploaded for ${order.orderNumber}`,
      `${membership.supplier.name} uploaded invoice ${invoice.invoiceNumber}.`,
      `/purchases/${orderId}`,
    );
    await this.audit.record({
      userId: actor.id,
      action: 'SUPPLIER_INVOICE_UPLOADED',
      context,
      metadata: { purchaseOrderId: orderId, invoiceId: invoice.id },
    });
    return invoice;
  }

  async invoiceFile(actor: AuthenticatedUser, invoiceId: string) {
    const invoice = await this.prisma.supplierInvoice.findUnique({
      where: { id: invoiceId },
      include: { purchaseOrder: { include: { branch: true } } },
    });
    if (!invoice) throw new NotFoundException('Invoice not found.');
    const supplierMembership = await this.prisma.supplierUser.findUnique({
      where: { userId: actor.id },
    });
    if (supplierMembership) {
      if (supplierMembership.supplierId !== invoice.purchaseOrder.supplierId)
        throw new ForbiddenException('Invoice access is denied.');
    } else {
      if (
        !actor.roles.includes('SUPER_ADMIN') &&
        !actor.permissions.some((permission) =>
          ['purchases:view', 'purchases:manage'].includes(permission),
        )
      )
        throw new ForbiddenException('Invoice access is denied.');
      const organizationId = await this.organizationId(actor.id);
      if (organizationId !== invoice.purchaseOrder.branch.organizationId)
        throw new ForbiddenException('Invoice access is denied.');
    }
    return invoice;
  }

  async preferences(userId: string, dto: SupplierPortalPreferencesDto) {
    const membership = await this.membership(userId);
    return this.prisma.supplier.update({
      where: { id: membership.supplierId },
      data: dto,
      select: {
        id: true,
        emailNotificationsEnabled: true,
        inAppNotificationsEnabled: true,
      },
    });
  }

  async notifyOrderIssued(purchaseOrderId: string) {
    const order = await this.prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: { supplier: { include: { organization: true } } },
    });
    if (!order || !order.supplier.portalEnabled) return;
    await this.notifySupplier(
      order.supplier,
      'PURCHASE_ORDER_ISSUED_TO_SUPPLIER',
      `New purchase order ${order.orderNumber}`,
      `A purchase order for ${Number(order.total).toFixed(2)} is ready for your response.`,
      `/supplier-dashboard/orders/${order.id}`,
    );
  }

  private orderChangesEnabled(supplier: {
    allowOrderChanges: boolean | null;
    organization: { supplierOrderChangesEnabled: boolean };
  }) {
    return supplier.allowOrderChanges ?? supplier.organization.supplierOrderChangesEnabled;
  }

  private emailEnabled(supplier: {
    emailNotificationsEnabled: boolean | null;
    organization: { supplierEmailNotificationsEnabled: boolean };
  }) {
    return supplier.organization.supplierEmailNotificationsEnabled &&
      (supplier.emailNotificationsEnabled ?? true);
  }

  private inAppEnabled(supplier: {
    inAppNotificationsEnabled: boolean | null;
    organization: { supplierInAppNotificationsEnabled: boolean };
  }) {
    return supplier.organization.supplierInAppNotificationsEnabled &&
      (supplier.inAppNotificationsEnabled ?? true);
  }

  private async notifySupplier(
    supplier: {
      id: string;
      organizationId: string;
      email: string | null;
      emailNotificationsEnabled: boolean | null;
      inAppNotificationsEnabled: boolean | null;
      organization: {
        supplierEmailNotificationsEnabled: boolean;
        supplierInAppNotificationsEnabled: boolean;
      };
    },
    eventType: string,
    title: string,
    message: string,
    actionUrl: string,
  ) {
    const users = await this.prisma.supplierUser.findMany({
      where: { supplierId: supplier.id },
      select: { userId: true, user: { select: { email: true } } },
    });
    if (this.inAppEnabled(supplier) && users.length)
      await this.prisma.appNotification.createMany({
        data: users.map(({ userId }) => ({
          organizationId: supplier.organizationId,
          recipientUserId: userId,
          supplierId: supplier.id,
          eventType,
          title,
          message,
          actionUrl,
        })),
      });
    if (this.emailEnabled(supplier)) {
      for (const { user } of users) {
        await this.prisma.notificationOutbox.create({
          data: {
            channel: NotificationChannel.EMAIL,
            recipient: user.email,
            subject: title,
            body: `<p>${message}</p>`,
            idempotencyKey: `${eventType}:${supplier.id}:${randomUUID()}`,
          },
        });
      }
    }
  }

  private async notifyInternal(
    organizationId: string,
    supplierId: string,
    eventType: string,
    title: string,
    message: string,
    actionUrl: string,
  ) {
    const users = await this.prisma.organizationUser.findMany({
      where: {
        organizationId,
        user: {
          roles: {
            some: {
              OR: [
                { role: { name: { in: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'] } } },
                {
                  role: {
                    permissions: {
                      some: { permission: { key: 'purchases:manage' } },
                    },
                  },
                },
              ],
            },
          },
        },
      },
      select: { userId: true },
    });
    if (!users.length) return;
    await this.prisma.appNotification.createMany({
      data: users.map(({ userId }) => ({
        organizationId,
        recipientUserId: userId,
        supplierId,
        eventType,
        title,
        message,
        actionUrl,
      })),
    });
  }

  private async organizationId(userId: string) {
    const membership = await this.prisma.organizationUser.findFirst({
      where: { userId },
      select: { organizationId: true },
    });
    if (!membership) throw new NotFoundException('Organization not found.');
    return membership.organizationId;
  }
}
