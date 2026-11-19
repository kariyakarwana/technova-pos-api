import { ConfigService } from '@nestjs/config';

/** One operator-managed SMTP server for authentication and tenant notifications. */
export function smtpOptions(config: ConfigService) {
  const port = Number(config.get('SMTP_PORT') ?? 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SMTP_PORT must be a valid TCP port.');
  }
  const secure = String(config.get('SMTP_SECURE') ?? (port === 465)).toLowerCase() === 'true';
  const requireTLS = String(config.get('SMTP_REQUIRE_TLS') ?? (config.get('NODE_ENV') === 'production')).toLowerCase() === 'true';
  return {
    host: config.getOrThrow<string>('SMTP_HOST'),
    port,
    secure,
    requireTLS,
    auth: {
      user: config.getOrThrow<string>('SMTP_USER'),
      pass: config.getOrThrow<string>('SMTP_PASSWORD'),
    },
  };
}
