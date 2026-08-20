import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuditOutcome, UserStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import nodemailer from 'nodemailer';

import {
  hashPassword,
  validatePasswordStrength,
  verifyPassword,
} from '../../common/security/password';
import {
  createEmailVerificationToken,
  createPasswordResetOtp,
  generateRawToken,
  hashOtp,
  hashToken,
  PASSWORD_RESET_GRANT_LIFETIME_MS,
} from '../../common/security/token';
import type { SecurityRequestContext } from '../../common/security/request';
import { AuthRepository, type LoginUser } from './auth.repository';

const ACCESS_TOKEN_LIFETIME_SECONDS = 15 * 60;
const REFRESH_TOKEN_LIFETIME_MS = 8 * 60 * 60 * 1000;

type LoginInput = {
  email: string;
  password: string;
  context: SecurityRequestContext;
};

type LoginResult = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    name: string | null;
    roles: string[];
    permissions: string[];
  };
};

@Injectable()
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(input: LoginInput): Promise<LoginResult> {
    const email = input.email.trim().toLowerCase();
    const identityHash = createHash('sha256').update(email).digest('hex');
    const user = await this.repository.findUserForLogin(email);
    const passwordMatches =
      user?.passwordHash != null
        ? await verifyPassword(input.password, user.passwordHash)
        : false;

    if (!user || !passwordMatches) {
      if (user) await this.repository.recordFailedLogin(user.id);

      await this.repository.recordAttempt({
        action: 'LOGIN',
        identityHash,
        ipHash: input.context.ipHash,
        successful: false,
      });
      await this.repository.createAuditEvent({
        userId: user?.id,
        action: 'AUTH_LOGIN_FAILED',
        outcome: AuditOutcome.FAILURE,
        ipHash: input.context.ipHash,
        userAgent: input.context.userAgent,
      });

      throw new UnauthorizedException('Invalid email or password.');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('This account is not active.');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException('This account is temporarily locked.');
    }

    if (!user.emailVerified) {
      throw new ForbiddenException('Verify your email before signing in.');
    }

    const roles = user.roles.map(({ role }) => role.name);
    const permissions = [
      ...new Set(
        user.roles.flatMap(({ role }) =>
          role.permissions.map(({ permission }) => permission.key),
        ),
      ),
    ];
    const refreshToken = generateRawToken();
    const now = new Date();

    await this.repository.createRefreshSession({
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      familyId: generateRawToken(),
      ipHash: input.context.ipHash,
      userAgent: input.context.userAgent,
      expiresAt: new Date(now.getTime() + REFRESH_TOKEN_LIFETIME_MS),
    });

    const accessToken = await this.jwtService.signAsync(
      {
        sub: user.id,
        email: user.email,
        roles,
        permissions,
        sessionVersion: user.sessionVersion,
      },
      {
        secret: this.jwtSecret(),
        expiresIn: ACCESS_TOKEN_LIFETIME_SECONDS,
      },
    );

    await this.repository.recordSuccessfulLogin(user.id);
    await this.repository.recordAttempt({
      action: 'LOGIN',
      identityHash,
      ipHash: input.context.ipHash,
      successful: true,
    });
    await this.repository.createAuditEvent({
      userId: user.id,
      action: 'AUTH_LOGIN_SUCCEEDED',
      outcome: AuditOutcome.SUCCESS,
      ipHash: input.context.ipHash,
      userAgent: input.context.userAgent,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TOKEN_LIFETIME_SECONDS,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roles,
        permissions,
      },
    };
  }

  async refresh(
    rawToken: string | undefined,
    context: SecurityRequestContext,
  ): Promise<LoginResult> {
    if (!rawToken)
      throw new UnauthorizedException('Authentication is required.');

    const session = await this.repository.findRefreshSession(
      hashToken(rawToken),
    );
    if (!session) throw new UnauthorizedException('The session is invalid.');

    if (session.revokedAt) {
      await this.repository.revokeRefreshFamily(
        session.familyId,
        'TOKEN_REUSE_DETECTED',
      );
      throw new UnauthorizedException('The session is invalid.');
    }

    if (
      session.expiresAt <= new Date() ||
      session.user.status !== UserStatus.ACTIVE
    ) {
      await this.repository.revokeRefreshSession(
        session.tokenHash,
        'EXPIRED_OR_INACTIVE',
      );
      throw new UnauthorizedException('The session has expired.');
    }

    const refreshToken = generateRawToken();
    await this.repository.rotateRefreshSession({
      previousId: session.id,
      userId: session.userId,
      tokenHash: hashToken(refreshToken),
      familyId: session.familyId,
      ipHash: context.ipHash,
      userAgent: context.userAgent,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_LIFETIME_MS),
    });

    return this.buildLoginResult(session.user, refreshToken);
  }

  async logout(
    rawToken: string | undefined,
    context: SecurityRequestContext,
  ): Promise<void> {
    if (!rawToken) return;
    const tokenHash = hashToken(rawToken);
    const session = await this.repository.findRefreshSession(tokenHash);
    await this.repository.revokeRefreshSession(tokenHash, 'LOGOUT');
    await this.repository.createAuditEvent({
      userId: session?.userId,
      action: 'AUTH_LOGOUT',
      outcome: AuditOutcome.SUCCESS,
      ipHash: context.ipHash,
      userAgent: context.userAgent,
    });
  }

  async currentUser(accessToken: string | undefined) {
    if (!accessToken)
      throw new UnauthorizedException('Authentication is required.');
    let payload: { sub: string; sessionVersion: number };
    try {
      payload = await this.jwtService.verifyAsync(accessToken, {
        secret: this.jwtSecret(),
      });
    } catch {
      throw new UnauthorizedException(
        'The access token is invalid or expired.',
      );
    }
    const user = await this.repository.findUserById(payload.sub);
    if (
      !user ||
      user.status !== UserStatus.ACTIVE ||
      user.sessionVersion !== payload.sessionVersion
    ) {
      throw new UnauthorizedException('The session is no longer valid.');
    }
    return this.safeUser(user);
  }

  async forgotPassword(emailInput: string, context: SecurityRequestContext) {
    const email = emailInput.trim().toLowerCase();
    const user = await this.repository.findUserForLogin(email);
    if (!user || user.status !== UserStatus.ACTIVE)
      return { accepted: true, challengeToken: '' };

    const token = createPasswordResetOtp();
    await this.repository.createSecurityToken({
      userId: user.id,
      purpose: 'PASSWORD_RESET',
      tokenHash: token.challengeHash,
      otpHash: token.otpHash,
      expiresAt: token.expiresAt,
    });
    await this.sendMail(
      user.email,
      'TechNova POS password reset code',
      `<p>Your TechNova POS password reset code is:</p><h2>${token.otp}</h2><p>It expires in 10 minutes.</p>`,
    );
    await this.repository.createAuditEvent({
      userId: user.id,
      action: 'AUTH_PASSWORD_RESET_OTP_SENT',
      outcome: AuditOutcome.SUCCESS,
      ipHash: context.ipHash,
      userAgent: context.userAgent,
    });
    return { accepted: true, challengeToken: token.challengeToken };
  }

  async verifyResetOtp(challengeToken: string, otp: string) {
    const record = await this.repository.findSecurityToken(
      hashToken(challengeToken),
      'PASSWORD_RESET',
    );
    if (
      !record ||
      !record.otpHash ||
      record.expiresAt <= new Date() ||
      record.attemptCount >= 5
    ) {
      throw new UnauthorizedException('The code is invalid or expired.');
    }
    if (hashOtp(challengeToken, otp) !== record.otpHash) {
      await this.repository.incrementTokenAttempts(record.id);
      throw new UnauthorizedException('The code is invalid or expired.');
    }
    const resetToken = generateRawToken();
    await this.repository.replaceResetChallengeWithGrant({
      id: record.id,
      grantHash: hashToken(resetToken),
      expiresAt: new Date(Date.now() + PASSWORD_RESET_GRANT_LIFETIME_MS),
    });
    return { resetToken };
  }

  async resetPassword(resetToken: string, password: string): Promise<void> {
    const validation = validatePasswordStrength(password);
    if (!validation.valid)
      throw new ForbiddenException(validation.errors.join(' '));
    const record = await this.repository.findSecurityToken(
      hashToken(resetToken),
      'PASSWORD_RESET',
    );
    if (!record || !record.verifiedAt || record.expiresAt <= new Date()) {
      throw new UnauthorizedException(
        'The reset request is invalid or expired.',
      );
    }
    await this.repository.resetPassword({
      tokenId: record.id,
      userId: record.userId,
      passwordHash: await hashPassword(password),
    });
  }

  async resendVerification(
    emailInput: string,
    context: SecurityRequestContext,
  ) {
    const user = await this.repository.findUserForLogin(
      emailInput.trim().toLowerCase(),
    );
    if (!user || user.emailVerified) return { accepted: true };
    const token = createEmailVerificationToken();
    await this.repository.createSecurityToken({
      userId: user.id,
      purpose: 'EMAIL_VERIFICATION',
      tokenHash: token.tokenHash,
      expiresAt: token.expiresAt,
    });
    const url = `${this.config.getOrThrow<string>('FRONTEND_URL')}/verify-email?token=${encodeURIComponent(token.rawToken)}`;
    await this.sendMail(
      user.email,
      'Verify your TechNova POS email',
      `<p><a href="${url}">Verify your email address</a></p>`,
    );
    await this.repository.createAuditEvent({
      userId: user.id,
      action: 'AUTH_EMAIL_VERIFICATION_REQUESTED',
      outcome: AuditOutcome.SUCCESS,
      ipHash: context.ipHash,
      userAgent: context.userAgent,
    });
    return { accepted: true };
  }

  async verifyEmail(rawToken: string): Promise<void> {
    const record = await this.repository.findSecurityToken(
      hashToken(rawToken),
      'EMAIL_VERIFICATION',
    );
    if (!record || record.expiresAt <= new Date())
      throw new UnauthorizedException(
        'The verification link is invalid or expired.',
      );
    await this.repository.verifyEmail(record.id, record.userId);
  }

  async googleAuthorizationUrl(): Promise<string> {
    const state = await this.jwtService.signAsync(
      { nonce: generateRawToken() },
      {
        secret: this.jwtSecret(),
        expiresIn: 300,
      },
    );
    const params = new URLSearchParams({
      client_id: this.googleClientId(),
      redirect_uri: this.googleCallbackUrl(),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  async googleCallback(
    code: string,
    state: string,
    context: SecurityRequestContext,
  ): Promise<LoginResult> {
    await this.jwtService.verifyAsync(state, {
      secret: this.jwtSecret(),
    });
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.googleClientId(),
        client_secret: this.googleClientSecret(),
        redirect_uri: this.googleCallbackUrl(),
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenResponse.ok)
      throw new UnauthorizedException('Google authentication failed.');
    const tokens = (await tokenResponse.json()) as { access_token: string };
    const profileResponse = await fetch(
      'https://openidconnect.googleapis.com/v1/userinfo',
      {
        headers: { authorization: `Bearer ${tokens.access_token}` },
      },
    );
    const profile = (await profileResponse.json()) as {
      sub: string;
      email: string;
      email_verified: boolean;
    };
    if (!profile.email_verified)
      throw new UnauthorizedException('Google email is not verified.');
    const user = await this.repository.findUserForLogin(
      profile.email.toLowerCase(),
    );
    if (!user || user.status !== UserStatus.ACTIVE)
      throw new UnauthorizedException(
        'This Google account is not provisioned for TechNova POS.',
      );
    await this.repository.linkGoogleAccount(user.id, profile.sub);
    const refreshToken = generateRawToken();
    await this.repository.createRefreshSession({
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      familyId: generateRawToken(),
      ipHash: context.ipHash,
      userAgent: context.userAgent,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_LIFETIME_MS),
    });
    return this.buildLoginResult(user, refreshToken);
  }

  private async buildLoginResult(
    user: LoginUser,
    refreshToken: string,
  ): Promise<LoginResult> {
    const safeUser = this.safeUser(user);
    const accessToken = await this.jwtService.signAsync(
      {
        sub: user.id,
        email: user.email,
        roles: safeUser.roles,
        permissions: safeUser.permissions,
        sessionVersion: user.sessionVersion,
      },
      {
        secret: this.jwtSecret(),
        expiresIn: ACCESS_TOKEN_LIFETIME_SECONDS,
      },
    );
    return {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TOKEN_LIFETIME_SECONDS,
      user: safeUser,
    };
  }

  private safeUser(user: LoginUser) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      roles: user.roles.map(({ role }) => role.name),
      permissions: [
        ...new Set(
          user.roles.flatMap(({ role }) =>
            role.permissions.map(({ permission }) => permission.key),
          ),
        ),
      ],
    };
  }

  private async sendMail(
    to: string,
    subject: string,
    html: string,
  ): Promise<void> {
    const transporter = nodemailer.createTransport({
      host: this.config.getOrThrow<string>('SMTP_HOST'),
      port: this.config.get<number>('SMTP_PORT') ?? 587,
      secure: false,
      auth: {
        user: this.config.getOrThrow<string>('SMTP_USER'),
        pass: this.config.getOrThrow<string>('SMTP_PASSWORD'),
      },
    });
    await transporter.sendMail({
      from: this.config.getOrThrow<string>('SMTP_FROM'),
      to,
      subject,
      html,
    });
  }

  private jwtSecret(): string {
    const value =
      this.config.get<string>('AUTH_JWT_ACCESS_SECRET') ??
      this.config.get<string>('JWT_ACCESS_PRIVATE_KEY');
    if (!value) throw new Error('JWT access signing secret is not configured.');
    return value.replace(/\\n/g, '\n');
  }

  private googleClientId(): string {
    return (
      this.config.get<string>('AUTH_GOOGLE_ID') ??
      this.config.getOrThrow<string>('GOOGLE_CLIENT_ID')
    );
  }

  private googleClientSecret(): string {
    return (
      this.config.get<string>('AUTH_GOOGLE_SECRET') ??
      this.config.getOrThrow<string>('GOOGLE_CLIENT_SECRET')
    );
  }

  private googleCallbackUrl(): string {
    return (
      this.config.get<string>('AUTH_GOOGLE_CALLBACK_URL') ??
      this.config.getOrThrow<string>('GOOGLE_CALLBACK_URL')
    );
  }
}
