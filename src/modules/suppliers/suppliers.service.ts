import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { PaginationDto, paginate } from '../../common/dto/pagination.dto';
import type { SecurityRequestContext } from '../../common/security/request';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';
@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}
  private async organizationId(userId: string) {
    const m = await this.prisma.organizationUser.findFirst({
      where: { userId },
    });
    if (!m) throw new NotFoundException('Organization not found.');
    return m.organizationId;
  }
  async list(userId: string, query: PaginationDto) {
    const organizationId = await this.organizationId(userId);
    const where = { organizationId };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.supplier.findMany({
        where,
        skip: query.skip,
        take: query.pageSize,
        orderBy: { name: 'asc' },
      }),
      this.prisma.supplier.count({ where }),
    ]);
    return paginate(data, total, query);
  }
  async create(
    actor: AuthenticatedUser,
    dto: CreateSupplierDto,
    context: SecurityRequestContext,
  ) {
    const organizationId = await this.organizationId(actor.id);
    try {
      const supplier = await this.prisma.supplier.create({
        data: {
          ...dto,
          code: dto.code.trim().toUpperCase(),
          organizationId,
          address: dto.address,
        },
      });
      await this.audit.record({
        userId: actor.id,
        action: 'SUPPLIER_CREATED',
        context,
        metadata: { supplierId: supplier.id },
      });
      return supplier;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException('Supplier code already exists.');
      throw error;
    }
  }
  async detail(userId: string, id: string) {
    const organizationId = await this.organizationId(userId);
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, organizationId },
      include: { purchaseOrders: { orderBy: { createdAt: 'desc' }, take: 20 } },
    });
    if (!supplier) throw new NotFoundException('Supplier not found.');
    return supplier;
  }
  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateSupplierDto,
    context: SecurityRequestContext,
  ) {
    const organizationId = await this.organizationId(actor.id);
    if (
      !(await this.prisma.supplier.findFirst({ where: { id, organizationId } }))
    )
      throw new NotFoundException('Supplier not found.');
    const supplier = await this.prisma.supplier.update({
      where: { id },
      data: {
        ...dto,
        address: dto.address,
      },
    });
    await this.audit.record({
      userId: actor.id,
      action: 'SUPPLIER_UPDATED',
      context,
      metadata: { supplierId: id },
    });
    return supplier;
  }
}
