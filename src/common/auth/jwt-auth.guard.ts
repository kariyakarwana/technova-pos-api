import { hasSubscriptionAccess } from '../../modules/subscriptions/billing-policy';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import { PrismaService } from '../../database/prisma/prisma.service';
import { AuthService } from '../../modules/auth/auth.service';
import type { AuthenticatedUser } from './authenticated-user';

type AuthenticatedRequest = Request & { user?: AuthenticatedUser };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService, private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.get('authorization');
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authentication is required.');
    }
    request.user = await this.authService.currentUser(
      authorization.slice('Bearer '.length),
    );
    if (!request.user.roles.includes('PLATFORM_SUPER_ADMIN')) {
      const memberships = await this.prisma.organizationUser.findMany({ where: { userId: request.user.id }, include: { organization: { include: { subscription: { include: { invoices: { where: { status: { in: ['PENDING', 'OVERDUE'] }, dueDate: { lte: new Date() } }, select: { id: true }, take: 1 } } } } } } });
      if (memberships.length > 1) throw new ForbiddenException('Ambiguous organization membership. Contact support.');
      // Customer/supplier principals may resolve organization through their profile.
      let organization: (typeof memberships)[number]['organization'] | undefined = memberships[0]?.organization;
      if (!organization) {
        const profile = await this.prisma.user.findUnique({ where: { id: request.user.id }, include: { customerProfile: { include: { organization: { include: { subscription: { include: { invoices: { where: { status: { in: ['PENDING', 'OVERDUE'] }, dueDate: { lte: new Date() } }, select: { id: true }, take: 1 } } } } } } }, supplierMembership: { include: { supplier: { include: { organization: { include: { subscription: { include: { invoices: { where: { status: { in: ['PENDING', 'OVERDUE'] }, dueDate: { lte: new Date() } }, select: { id: true }, take: 1 } } } } } } } } } } });
        organization = profile?.customerProfile?.organization ?? profile?.supplierMembership?.supplier?.organization;
      }
      const recoveryRoute = ['/api/v1/subscription/', '/api/v1/auth/me', '/api/v1/auth/logout', '/api/v1/auth/change-temporary-password', '/api/v1/auth/change-password'].some(path => request.path === path || (path.endsWith('/') && request.path.startsWith(path)));
      if (!organization && !recoveryRoute) throw new ForbiddenException('Organization membership is required.');
      const sub = organization?.subscription;
      if (!recoveryRoute && organization && (organization.status !== 'ACTIVE' || !hasSubscriptionAccess(sub))) {
        throw new ForbiddenException('Organization subscription is inactive. Contact your administrator or NxCodeWorks billing.');
      }
    }
    return true;
  }
}
