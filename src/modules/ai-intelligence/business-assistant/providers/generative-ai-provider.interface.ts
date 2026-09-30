import { AssistantStructuredOutput } from '../interfaces/assistant-response.interface';

export interface GenerativeAiPromptContext {
  systemPrompt: string;
  userMessage: string;
  contextBlocks?: Array<{ label: string; content: string }>;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface GenerativeAiResult {
  content: string;
  structuredOutput?: AssistantStructuredOutput;
  inputTokens?: number;
  outputTokens?: number;
  model: string;
}

export interface IGenerativeAiProvider {
  generateResponse(context: GenerativeAiPromptContext): Promise<GenerativeAiResult>;
  isAvailable(): boolean;
  getModelName(): string;
}

export const GENERATIVE_AI_PROVIDER = Symbol('GENERATIVE_AI_PROVIDER');
