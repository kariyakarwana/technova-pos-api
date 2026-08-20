import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { getSecurityRequestContext } from '../../common/security/request';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import {
  EmailDto,
  ResetPasswordDto,
  VerifyEmailDto,
  VerifyResetOtpDto,
} from './dto/auth.dto';

const REFRESH_COOKIE = 'technova_refresh';
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 8 * 60 * 60 * 1000,
};

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true })
    response: Response,
  ) {
    const context = getSecurityRequestContext(request);

    const result = await this.authService.login({
      email: dto.email,
      password: dto.password,
      context,
    });

    response.cookie(
      REFRESH_COOKIE,
      result.refreshToken,
      REFRESH_COOKIE_OPTIONS,
    );

    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: result.user,
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.refresh(
      request.cookies?.[REFRESH_COOKIE] as string | undefined,
      getSecurityRequestContext(request),
    );
    response.cookie(
      REFRESH_COOKIE,
      result.refreshToken,
      REFRESH_COOKIE_OPTIONS,
    );
    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: result.user,
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authService.logout(
      request.cookies?.[REFRESH_COOKIE] as string | undefined,
      getSecurityRequestContext(request),
    );
    response.clearCookie(REFRESH_COOKIE, { path: '/' });
  }

  @Get('me')
  me(@Req() request: Request) {
    return this.authService.currentUser(this.bearerToken(request));
  }

  @Post('forgot-password')
  forgotPassword(@Body() dto: EmailDto, @Req() request: Request) {
    return this.authService.forgotPassword(
      dto.email,
      getSecurityRequestContext(request),
    );
  }

  @Post('verify-reset-otp')
  verifyResetOtp(@Body() dto: VerifyResetOtpDto) {
    return this.authService.verifyResetOtp(dto.challengeToken, dto.otp);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.resetToken, dto.password);
  }

  @Post('resend-verification')
  resendVerification(@Body() dto: EmailDto, @Req() request: Request) {
    return this.authService.resendVerification(
      dto.email,
      getSecurityRequestContext(request),
    );
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto.token);
  }

  @Get('google')
  async google(@Res() response: Response) {
    response.redirect(await this.authService.googleAuthorizationUrl());
  }

  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const result = await this.authService.googleCallback(
      code,
      state,
      getSecurityRequestContext(request),
    );
    response.cookie(
      REFRESH_COOKIE,
      result.refreshToken,
      REFRESH_COOKIE_OPTIONS,
    );
    response.cookie('technova_access', result.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: result.expiresIn * 1000,
    });
    response.redirect(
      `${process.env.FRONTEND_URL ?? 'http://localhost:3000'}/dashboard`,
    );
  }

  private bearerToken(request: Request): string | undefined {
    const value = request.get('authorization');
    return value?.startsWith('Bearer ') ? value.slice(7) : undefined;
  }
}
