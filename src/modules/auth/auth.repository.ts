import { Injectable } from '@nestjs/common';
import { AuditOutcome, Prisma, TokenPurpose } from '@prisma/client';

import { PrismaService } from '../../database/prisma/prisma.service';

const loginUserInclude = {
  roles: {
    include: {
      role: {
        include: {
          permissions: {
            include: { permission: true },
          },
        },
      },
    },
  },
} satisfies Prisma.UserInclude;

export type LoginUser = Prisma.UserGetPayload<{
  include: typeof loginUserInclude;
}>;

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  findUserForLogin(email: string): Promise<LoginUser | null> {
    return this.prisma.user.findUnique({
      where: { email },
      include: loginUserInclude,
    });
  }

  findUserById(id: string): Promise<LoginUser | null> {
    return this.prisma.user.findUnique({
      where: { id },
      include: loginUserInclude,
    });
  }

  findRefreshSession(tokenHash: string) {
    return this.prisma.refreshSession.findUnique({
      where: { tokenHash },
      include: { user: { include: loginUserInclude } },
    });
  }

  async rotateRefreshSession(input: {
    previousId: string;
    userId: string;
    tokenHash: string;
    familyId: string;
    ipHash: string;
    userAgent: string | null;
    expiresAt: Date;
  }): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.refreshSession.update({
        where: { id: input.previousId },
        data: {
          revokedAt: new Date(),
          revokeReason: 'ROTATED',
          lastUsedAt: new Date(),
        },
      }),
      this.prisma.refreshSession.create({
        data: {
          userId: input.userId,
          tokenHash: input.tokenHash,
          familyId: input.familyId,
          parentSessionId: input.previousId,
          ipHash: input.ipHash,
          userAgent: input.userAgent,
          expiresAt: input.expiresAt,
        },
      }),
    ]);
  }

  async revokeRefreshSession(tokenHash: string, reason: string): Promise<void> {
    await this.prisma.refreshSession.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }

  async revokeRefreshFamily(familyId: string, reason: string): Promise<void> {
    await this.prisma.refreshSession.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }

  async createSecurityToken(input: {
    userId: string;
    purpose: TokenPurpose;
    tokenHash: string;
    expiresAt: Date;
    otpHash?: string;
  }): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.securityToken.updateMany({
        where: { userId: input.userId, purpose: input.purpose, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.securityToken.create({ data: input }),
    ]);
  }

  findSecurityToken(tokenHash: string, purpose: TokenPurpose) {
    return this.prisma.securityToken.findFirst({
      where: { tokenHash, purpose, usedAt: null },
      include: { user: true },
    });
  }

  async incrementTokenAttempts(id: string): Promise<void> {
    await this.prisma.securityToken.update({
      where: { id },
      data: { attemptCount: { increment: 1 } },
    });
  }

  async replaceResetChallengeWithGrant(input: {
    id: string;
    grantHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.prisma.securityToken.update({
      where: { id: input.id },
      data: {
        tokenHash: input.grantHash,
        otpHash: null,
        verifiedAt: new Date(),
        expiresAt: input.expiresAt,
        attemptCount: 0,
      },
    });
  }

  async resetPassword(input: {
    tokenId: string;
    userId: string;
    passwordHash: string;
  }): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: input.userId },
        data: {
          passwordHash: input.passwordHash,
          passwordChangedAt: new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
          sessionVersion: { increment: 1 },
        },
      }),
      this.prisma.securityToken.update({
        where: { id: input.tokenId },
        data: { usedAt: new Date() },
      }),
      this.prisma.refreshSession.updateMany({
        where: { userId: input.userId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: 'PASSWORD_RESET' },
      }),
    ]);
  }

  async verifyEmail(tokenId: string, userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { emailVerified: new Date(), status: 'ACTIVE' },
      }),
      this.prisma.securityToken.update({
        where: { id: tokenId },
        data: { usedAt: new Date() },
      }),
    ]);
  }

  async linkGoogleAccount(
    userId: string,
    providerAccountId: string,
  ): Promise<void> {
    await this.prisma.account.upsert({
      where: {
        provider_providerAccountId: { provider: 'google', providerAccountId },
      },
      update: { userId },
      create: { userId, type: 'oauth', provider: 'google', providerAccountId },
    });
  }

  async recordFailedLogin(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: { increment: 1 } },
    });
  }

  async recordSuccessfulLogin(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });
  }

  async recordAttempt(input: {
    action: string;
    identityHash: string;
    ipHash: string;
    successful: boolean;
  }): Promise<void> {
    await this.prisma.authAttempt.create({ data: input });
  }

  async createRefreshSession(input: {
    userId: string;
    tokenHash: string;
    familyId: string;
    ipHash: string;
    userAgent: string | null;
    expiresAt: Date;
  }): Promise<void> {
    await this.prisma.refreshSession.create({ data: input });
  }

  async createAuditEvent(input: {
    userId?: string;
    action: string;
    outcome: AuditOutcome;
    ipHash: string;
    userAgent: string | null;
    metadata?: Prisma.InputJsonValue;
  }): Promise<void> {
    await this.prisma.auditEvent.create({ data: input });
  }
}
