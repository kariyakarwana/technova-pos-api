import { AssistantRequestContext } from '../interfaces/assistant-context.interface';
import { AssistantStructuredOutput } from '../interfaces/assistant-response.interface';

export interface OrchestrationRequest {
  message: string;
  conversationId?: string;
  context: AssistantRequestContext;
}

export interface OrchestrationResult {
  structuredOutput: AssistantStructuredOutput;
  tokensUsed?: number;
  model: string;
  degraded?: boolean;
}
