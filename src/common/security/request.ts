import { createHash } from 'node:crypto';
import type { Request } from 'express';

const USER_AGENT_MAX_LENGTH = 500;

export interface SecurityRequestContext {
  ipHash: string;
  userAgent: string | null;
}

function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function getSecurityRequestContext(
  request: Request,
): SecurityRequestContext {
  const forwarded = request.headers['x-forwarded-for'];

  const forwardedIp =
    typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : undefined;

  const ip =
    forwardedIp || request.ip || request.socket.remoteAddress || 'unknown';

  const rawUserAgent = request.get('user-agent');

  const userAgent = rawUserAgent
    ? rawUserAgent.slice(0, USER_AGENT_MAX_LENGTH)
    : null;

  return {
    ipHash: hashValue(ip),
    userAgent,
  };
}
