import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { isPlatformSuperAdmin } from '../../../common/auth/privileged-access';

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user || !isPlatformSuperAdmin(user)) {
      throw new ForbiddenException(
        'Access denied: This operation requires Platform Super Admin privileges.',
      );
    }

    return true;
  }
}
