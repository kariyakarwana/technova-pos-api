import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { defer, lastValueFrom } from 'rxjs';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma/prisma.service';

@Injectable()
export class PlatformAuditInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<{ method: string; path: string; user: { id: string } }>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next.handle();
    return defer(async () => {
      const metadata = { requestId: randomUUID(), method: request.method, path: request.path };
      // Intent is persisted before mutation; request bodies may contain passwords and are never recorded.
      await this.prisma.auditEvent.create({ data: { userId: request.user.id, action: 'PLATFORM_MUTATION_STARTED', outcome: 'SUCCESS', metadata } });
      try {
        const result: unknown = await lastValueFrom(next.handle());
        await this.prisma.auditEvent.create({ data: { userId: request.user.id, action: 'PLATFORM_MUTATION_COMPLETED', outcome: 'SUCCESS', metadata } });
        return result;
      } catch (error) {
        await this.prisma.auditEvent.create({ data: { userId: request.user.id, action: 'PLATFORM_MUTATION_FAILED', outcome: 'FAILURE', metadata } });
        throw error;
      }
    });
  }
}
