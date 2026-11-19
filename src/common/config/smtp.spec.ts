import { ConfigService } from '@nestjs/config';
import { smtpOptions } from './smtp';

describe('operator SMTP configuration', () => {
  const base = { SMTP_HOST: 'smtp.example.test', SMTP_USER: 'test', SMTP_PASSWORD: 'test-only', NODE_ENV: 'production' };
  it('uses STARTTLS for the existing port 587 server', () => {
    expect(smtpOptions(new ConfigService({ ...base, SMTP_PORT: '587' })))
      .toMatchObject({ port: 587, secure: false, requireTLS: true });
  });
  it('supports a later switch to implicit TLS through environment configuration', () => {
    expect(smtpOptions(new ConfigService({ ...base, SMTP_PORT: '465' })))
      .toMatchObject({ port: 465, secure: true });
  });
  it('allows explicitly configured isolated development mail capture', () => {
    expect(smtpOptions(new ConfigService({ ...base, SMTP_PORT: '1025', SMTP_REQUIRE_TLS: 'false' })))
      .toMatchObject({ port: 1025, secure: false, requireTLS: false });
  });
  it('rejects invalid ports', () => {
    expect(() => smtpOptions(new ConfigService({ ...base, SMTP_PORT: 'invalid' }))).toThrow('SMTP_PORT');
  });
});
