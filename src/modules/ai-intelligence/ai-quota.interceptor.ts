import { CallHandler, ExecutionContext, Injectable, NestInterceptor, ForbiddenException } from '@nestjs/common';
import { catchError, from, switchMap } from 'rxjs';
import { PrismaService } from '../../database/prisma/prisma.service';
import { QuotaService } from '../subscriptions/quota.service';

@Injectable()
export class AiQuotaInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService, private readonly quota: QuotaService) {}
  async intercept(context: ExecutionContext, next: CallHandler) {
    const userId = context.switchToHttp().getRequest<{user: {id: string}}>().user.id;
    const memberships = await this.prisma.organizationUser.findMany({ where: { userId } });
    if (memberships.length !== 1) throw new ForbiddenException('One organization membership is required.');
    const refund = await this.quota.reserveUsage(memberships[0].organizationId, 'aiRequestsUsed');
    return next.handle().pipe(catchError(error => from(refund()).pipe(switchMap(() => { throw error; }))));
  }
}
