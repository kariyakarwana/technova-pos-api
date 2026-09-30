import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { RecordStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { AssistantChatDto } from './dto/assistant-chat.dto';
import { AssistantRequestContext } from './interfaces/assistant-context.interface';
import { AssistantChatResponseDto } from './interfaces/assistant-response.interface';
import { BusinessAssistantOrchestrator } from './orchestrator/business-assistant.orchestrator';

@Injectable()
export class BusinessAssistantService {
  private readonly logger = new Logger(BusinessAssistantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: BusinessAssistantOrchestrator,
  ) {}

  async chat(user: AuthenticatedUser, dto: AssistantChatDto): Promise<AssistantChatResponseDto> {
    const startTime = Date.now();

    // 1. Derive organization context exclusively from authenticated user
    const organizationId = await this.resolveOrganizationId(user.id);

    // 2. Validate branch context if specified
    if (dto.branchId) {
      await this.validateBranch(dto.branchId, organizationId);
    }

    // 3. Assemble secure request context
    const context: AssistantRequestContext = {
      userId: user.id,
      organizationId,
      branchId: dto.branchId,
      userPermissions: user.permissions ?? [],
      userRoles: user.roles ?? [],
      userName: user.name,
    };

    const conversationId = dto.conversationId || randomUUID();

    // 4. Delegate to orchestrator
    const orchestrationResult = await this.orchestrator.orchestrate({
      message: dto.message,
      conversationId,
      context,
    });

    const processingTimeMs = Date.now() - startTime;

    return {
      conversationId,
      message: {
        id: randomUUID(),
        role: 'assistant',
        createdAt: new Date().toISOString(),
        ...orchestrationResult.structuredOutput,
      },
      metadata: {
        model: orchestrationResult.model,
        tokensUsed: orchestrationResult.tokensUsed,
        degraded: orchestrationResult.degraded,
        processingTimeMs,
      },
    };
  }

  private async resolveOrganizationId(userId: string): Promise<string> {
    const membership = await this.prisma.organizationUser.findFirst({
      where: { userId },
      select: { organizationId: true },
    });

    if (!membership) {
      throw new NotFoundException('Authenticated user is not associated with an organization.');
    }

    return membership.organizationId;
  }

  private async validateBranch(branchId: string, organizationId: string): Promise<void> {
    const branch = await this.prisma.branch.findFirst({
      where: {
        id: branchId,
        organizationId,
        status: RecordStatus.ACTIVE,
      },
      select: { id: true },
    });

    if (!branch) {
      throw new NotFoundException('Branch not found or does not belong to your organization.');
    }
  }
}
