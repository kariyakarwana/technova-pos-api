import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../../common/auth/jwt-auth.guard';
import { RequirePermissions } from '../../../common/auth/permissions.decorator';
import { PermissionsGuard } from '../../../common/auth/permissions.guard';
import { BusinessAssistantService } from './business-assistant.service';
import { AssistantChatDto } from './dto/assistant-chat.dto';
import { AssistantChatResponseDto } from './interfaces/assistant-response.interface';

@Controller('ai-intelligence/business-assistant')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BusinessAssistantController {
  constructor(private readonly assistantService: BusinessAssistantService) {}

  @Post('chat')
  @RequirePermissions('dashboard:view')
  chat(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AssistantChatDto,
  ): Promise<AssistantChatResponseDto> {
    return this.assistantService.chat(user, dto);
  }
}
