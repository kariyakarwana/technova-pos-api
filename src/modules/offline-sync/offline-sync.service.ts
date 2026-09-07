import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SyncBatchStatus, SyncOperationStatus } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import type { SecurityRequestContext } from '../../common/security/request';
import { PrismaService } from '../../database/prisma/prisma.service';
import { CreateSaleDto } from '../sales/dto/sale.dto';
import { SalesService } from '../sales/sales.service';
import { OfflineSyncBatchDto } from './dto/offline-sync.dto';
import { PaginationDto, paginate } from '../../common/dto/pagination.dto';

type SyncBatchWithOperations = Prisma.OfflineSyncBatchGetPayload<{
  include: { operations: true };
}>;
@Injectable()
export class OfflineSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sales: SalesService,
  ) {}
  async submit(
    user: AuthenticatedUser,
    dto: OfflineSyncBatchDto,
    context: SecurityRequestContext,
  ) {
    const repeated = await this.prisma.offlineSyncBatch.findUnique({
      where: { clientBatchId: dto.clientBatchId },
      include: { operations: { orderBy: { createdAt: 'asc' } } },
    });
    if (repeated) {
      if (repeated.userId !== user.id || repeated.deviceId !== dto.deviceId)
        throw new ConflictException(
          'The batch identifier belongs to another sync source.',
        );
      const incoming = new Map(
        dto.operations.map((operation) => [operation.clientOperationId, operation]),
      );
      const matches =
        repeated.operations.length === dto.operations.length &&
        repeated.operations.every((operation) => {
          const candidate = incoming.get(operation.clientOperationId);
          return (
            candidate?.operationType === operation.operationType &&
            JSON.stringify(candidate.payload) === JSON.stringify(operation.payload)
          );
        });
      if (!matches)
        throw new ConflictException(
          'The batch identifier was reused with different operations.',
        );
      return repeated;
    }
    const operationIds = dto.operations.map((o) => o.clientOperationId);
    if (new Set(operationIds).size !== operationIds.length)
      throw new BadRequestException(
        'Client operation identifiers must be unique within a batch.',
      );
    if (
      await this.prisma.offlineSyncOperation.count({
        where: { clientOperationId: { in: operationIds } },
      })
    )
      throw new ConflictException(
        'One or more operation identifiers were already used in another batch.',
      );
    let batch: SyncBatchWithOperations;
    try {
      batch = await this.prisma.offlineSyncBatch.create({
        data: {
          userId: user.id,
          clientBatchId: dto.clientBatchId,
          deviceId: dto.deviceId,
          operations: {
            create: dto.operations.map((operation) => ({
              clientOperationId: operation.clientOperationId,
              operationType: operation.operationType,
              clientTimestamp: new Date(operation.clientTimestamp),
              payload: operation.payload as Prisma.InputJsonValue,
            })),
          },
        },
        include: { operations: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException(
          'Batch or operation identifier already exists.',
        );
      throw error;
    }
    await this.prisma.offlineSyncBatch.update({
      where: { id: batch.id },
      data: { status: SyncBatchStatus.PROCESSING },
    });
    let applied = 0,
      rejected = 0;
    for (const operation of batch.operations) {
      try {
        const response = await this.execute(
          user,
          operation.operationType,
          operation.payload as Record<string, unknown>,
          context,
        );
        await this.prisma.offlineSyncOperation.update({
          where: { id: operation.id },
          data: {
            status: SyncOperationStatus.APPLIED,
            response: this.json(response),
            processedAt: new Date(),
          },
        });
        applied++;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Operation rejected';
        const code =
          error instanceof HttpException
            ? String(error.getStatus())
            : 'SYNC_OPERATION_FAILED';
        await this.prisma.offlineSyncOperation.update({
          where: { id: operation.id },
          data: {
            status: SyncOperationStatus.REJECTED,
            errorCode: code,
            errorMessage: message.slice(0, 1000),
            processedAt: new Date(),
          },
        });
        rejected++;
      }
    }
    const status =
      rejected === 0
        ? SyncBatchStatus.COMPLETED
        : applied === 0
          ? SyncBatchStatus.FAILED
          : SyncBatchStatus.PARTIALLY_FAILED;
    await this.prisma.offlineSyncBatch.update({
      where: { id: batch.id },
      data: { status, completedAt: new Date() },
    });
    return this.status(user.id, batch.id);
  }
  async status(userId: string, id: string) {
    const batch = await this.prisma.offlineSyncBatch.findFirst({
      where: { id, userId },
      include: { operations: { orderBy: { createdAt: 'asc' } } },
    });
    if (!batch) throw new NotFoundException('Sync batch not found.');
    return batch;
  }
  async byClientId(userId: string, clientBatchId: string) {
    const batch = await this.prisma.offlineSyncBatch.findFirst({
      where: { clientBatchId, userId },
      include: { operations: { orderBy: { createdAt: 'asc' } } },
    });
    if (!batch) throw new NotFoundException('Sync batch not found.');
    return batch;
  }
  private async execute(
    user: AuthenticatedUser,
    type: string,
    payload: Record<string, unknown>,
    context: SecurityRequestContext,
  ) {
    if (type === 'SALE_CREATE') {
      const dto = plainToInstance(CreateSaleDto, payload);
      const errors = await validate(dto, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      if (errors.length) throw new BadRequestException(errors);
      return this.sales.create(user, dto, context);
    }
    throw new BadRequestException(`Unsupported offline operation: ${type}`);
  }
  private json(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
  }

  async list(userId: string, query: PaginationDto) {
    const where = { userId };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.offlineSyncBatch.findMany({
        where,
        skip: query.skip,
        take: query.pageSize,
        include: { operations: { orderBy: { createdAt: 'asc' } } },
        orderBy: { receivedAt: 'desc' },
      }),
      this.prisma.offlineSyncBatch.count({ where }),
    ]);
    return paginate(data, total, query);
  }
}
