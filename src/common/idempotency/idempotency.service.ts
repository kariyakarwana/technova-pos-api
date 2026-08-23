import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';

import { PrismaService } from '../../database/prisma/prisma.service';

const IDEMPOTENCY_LIFETIME_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  hashRequest(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  async begin(key: string, scope: string, requestHash: string) {
    const existing = await this.prisma.idempotencyKey.findUnique({
      where: { key },
    });
    if (existing) {
      if (existing.scope !== scope || existing.requestHash !== requestHash) {
        throw new ConflictException(
          'The idempotency key was already used for another request.',
        );
      }
      return existing;
    }
    return this.prisma.idempotencyKey.create({
      data: {
        key,
        scope,
        requestHash,
        expiresAt: new Date(Date.now() + IDEMPOTENCY_LIFETIME_MS),
      },
    });
  }

  async complete(
    id: string,
    responseStatus: number,
    responseBody: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.idempotencyKey.update({
      where: { id },
      data: { responseStatus, responseBody },
    });
  }

  async removeExpired(): Promise<number> {
    const result = await this.prisma.idempotencyKey.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
  }
}
