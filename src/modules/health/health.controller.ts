import { PrismaService } from '../../database/prisma/prisma.service';
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}
  @Get()
  async check() {
    await this.prisma.plan.count();
    await this.prisma.subscription.count();
    return {
      status: 'ok',
      service: 'technova-pos-api',
      timestamp: new Date().toISOString(),
    };
  }
}
