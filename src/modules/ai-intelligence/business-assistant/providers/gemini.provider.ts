import { GoogleGenAI } from '@google/genai';
import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssistantStructuredOutput } from '../interfaces/assistant-response.interface';
import {
  GenerativeAiPromptContext,
  GenerativeAiResult,
  IGenerativeAiProvider,
} from './generative-ai-provider.interface';

@Injectable()
export class GeminiProvider implements IGenerativeAiProvider {
  private readonly logger = new Logger(GeminiProvider.name);
  private readonly apiKey: string | null;
  private readonly primaryModel: string;
  private readonly fallbackModel: string;
  private client: GoogleGenAI | null = null;
  private readonly maxPrimaryAttempts = 3;
  private readonly maxFallbackAttempts = 2;
  private readonly baseDelayMs: number;

  constructor(config: ConfigService) {
    const rawKey = config.get<string>('GEMINI_API_KEY');
    this.apiKey = rawKey && rawKey.trim().length > 0 ? rawKey.trim() : null;
    this.primaryModel = config.get<string>('GEMINI_MODEL') || 'gemini-3.8-flash';
    this.fallbackModel = config.get<string>('GEMINI_FALLBACK_MODEL') || 'gemini-3.5-flash';

    const configuredDelay = config.get<string | number>('GEMINI_RETRY_BASE_DELAY_MS');
    if (configuredDelay !== undefined && configuredDelay !== null) {
      this.baseDelayMs = Number(configuredDelay);
    } else {
      this.baseDelayMs = process.env.NODE_ENV === 'test' ? 0 : 1000;
    }

    if (this.apiKey) {
      try {
        this.client = new GoogleGenAI({ apiKey: this.apiKey });
        this.logger.log(
          `GeminiProvider initialized with primary model: "${this.primaryModel}", fallback model: "${this.fallbackModel}"`,
        );
      } catch (err) {
        this.logger.error('Failed to initialize GoogleGenAI client', this.sanitizeError(err));
      }
    } else {
      this.logger.warn('GEMINI_API_KEY is not configured. GeminiProvider will operate in degraded mode.');
    }
  }

  isAvailable(): boolean {
    return Boolean(this.client && this.apiKey);
  }

  getModelName(): string {
    return this.primaryModel;
  }

  getFallbackModelName(): string {
    return this.fallbackModel;
  }

  async generateResponse(context: GenerativeAiPromptContext): Promise<GenerativeAiResult> {
    if (!this.client || !this.apiKey) {
      throw new ServiceUnavailableException(
        'Gemini API is not configured. Please ensure GEMINI_API_KEY is set in environment configuration.',
      );
    }

    const contents = this.buildContents(context);

    // 1. Attempt Primary Model with bounded retries
    try {
      return await this.executeWithModel(
        this.primaryModel,
        this.maxPrimaryAttempts,
        contents,
        context,
        false,
      );
    } catch (primaryError: unknown) {
      if (primaryError instanceof ServiceUnavailableException) {
        throw primaryError;
      }

      const classification = this.classifyError(primaryError);

      // Do NOT attempt fallback after permanent errors (400, 401, 403, 404, malformed)
      if (!classification.isTransient) {
        this.logger.error(
          `Primary model "${this.primaryModel}" failed with permanent error (${classification.status}). Fallback will not be attempted.`,
          this.sanitizeError(primaryError),
        );
        throw new BadGatewayException(
          'The generative AI service is currently unable to complete your request. Please try again shortly.',
        );
      }

      // If no distinct fallback model is configured, fail immediately
      if (!this.fallbackModel || this.fallbackModel === this.primaryModel) {
        this.logger.error(
          `Primary model "${this.primaryModel}" exhausted retries and no alternate fallback model is configured.`,
          this.sanitizeError(primaryError),
        );
        throw new BadGatewayException(
          'The generative AI service is currently unable to complete your request. Please try again shortly.',
        );
      }

      // Log primary exhaustion and fallback attempt (safe logging: no prompts, secrets, or PII)
      this.logger.warn(
        `Primary model "${this.primaryModel}" exhausted retries due to transient error (${classification.status}). Attempting fallback model "${this.fallbackModel}".`,
      );

      // 2. Attempt Fallback Model with bounded retries
      try {
        const fallbackResult = await this.executeWithModel(
          this.fallbackModel,
          this.maxFallbackAttempts,
          contents,
          context,
          true,
        );
        this.logger.log(`Fallback model "${this.fallbackModel}" succeeded.`);
        return fallbackResult;
      } catch (fallbackError: unknown) {
        // Log final fallback failure
        this.logger.error(
          `Fallback model "${this.fallbackModel}" also failed. All attempts exhausted.`,
          this.sanitizeError(fallbackError),
        );
        throw new BadGatewayException(
          'The generative AI service is currently unable to complete your request. Please try again shortly.',
        );
      }
    }
  }

  private async executeWithModel(
    modelName: string,
    maxAttempts: number,
    contents: Array<{ role: string; parts: Array<{ text: string }> }>,
    context: GenerativeAiPromptContext,
    isFallback = false,
  ): Promise<GenerativeAiResult> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await this.client!.models.generateContent({
          model: modelName,
          contents,
          config: {
            systemInstruction: context.systemPrompt,
            responseMimeType: 'application/json',
            temperature: context.temperature ?? 0.2,
            maxOutputTokens: context.maxOutputTokens ?? 2048,
          },
        });

        const rawText = response.text ?? '';
        const structuredOutput = this.parseStructuredOutput(rawText);

        return {
          content: rawText,
          structuredOutput,
          inputTokens: response.usageMetadata?.promptTokenCount,
          outputTokens: response.usageMetadata?.candidatesTokenCount,
          model: modelName,
        };
      } catch (error: unknown) {
        if (error instanceof ServiceUnavailableException) {
          throw error;
        }

        const classification = this.classifyError(error);
        const canRetry = classification.isTransient && attempt < maxAttempts;

        if (classification.isTransient) {
          this.logger.warn(
            `Gemini request failed with transient error on ${isFallback ? 'fallback' : 'primary'} model "${modelName}". Attempt: ${attempt}/${maxAttempts} Status: ${classification.status} Retrying: ${canRetry}`,
          );
        }

        if (canRetry) {
          const delay = this.calculateBackoffDelay(attempt);
          if (delay > 0) {
            await this.sleep(delay);
          }
          continue;
        }

        // Non-transient or exhausted on this model
        if (!classification.isTransient) {
          this.logger.error(
            `Gemini generateContent call failed on ${isFallback ? 'fallback' : 'primary'} model "${modelName}" with permanent error. Status: ${classification.status} Retrying: false`,
            this.sanitizeError(error),
          );
        } else {
          this.logger.error(
            `Gemini generateContent call failed on ${isFallback ? 'fallback' : 'primary'} model "${modelName}". Attempt: ${attempt}/${maxAttempts} Status: ${classification.status} Retrying: false`,
            this.sanitizeError(error),
          );
        }

        throw error;
      }
    }

    throw new BadGatewayException(
      'The generative AI service is currently unable to complete your request. Please try again shortly.',
    );
  }

  private classifyError(error: unknown): { isTransient: boolean; status: number | string } {
    if (!error) {
      return { isTransient: false, status: 'UNKNOWN' };
    }

    const errObj = error as Record<string, any>;
    const rawStatus = errObj.status ?? errObj.statusCode ?? errObj.code;
    const message = error instanceof Error ? error.message : String(error);

    let numericStatus: number | null = null;
    if (typeof rawStatus === 'number') {
      numericStatus = rawStatus;
    } else if (typeof rawStatus === 'string' && /^\d{3}$/.test(rawStatus)) {
      numericStatus = parseInt(rawStatus, 10);
    }

    if (numericStatus === null) {
      const codeMatch = message.match(/"code"\s*:\s*(\d{3})/);
      if (codeMatch) {
        numericStatus = parseInt(codeMatch[1], 10);
      } else {
        const httpMatch = message.match(/\b(400|401|403|404|408|429|500|502|503|504)\b/);
        if (httpMatch) {
          numericStatus = parseInt(httpMatch[1], 10);
        }
      }
    }

    // Explicit non-transient status codes
    if (numericStatus !== null && [400, 401, 403, 404].includes(numericStatus)) {
      return { isTransient: false, status: numericStatus };
    }

    // Explicit transient status codes
    if (numericStatus !== null && [503, 429, 408].includes(numericStatus)) {
      return { isTransient: true, status: numericStatus };
    }

    // Text patterns for non-transient errors
    const lowerMsg = message.toLowerCase();
    const nonTransientPatterns = [
      'invalid_argument',
      'api_key_invalid',
      'permission_denied',
      'not_found',
      'model not found',
      'invalid model',
      'unauthenticated',
      'malformed',
    ];
    if (nonTransientPatterns.some((pattern) => lowerMsg.includes(pattern))) {
      return { isTransient: false, status: numericStatus ?? 'NON_TRANSIENT' };
    }

    // Text patterns for transient errors
    const transientPatterns = [
      'unavailable',
      'resource_exhausted',
      'deadline_exceeded',
      'high demand',
      'spikes in demand',
      'temporarily unavailable',
      'fetch failed',
      'connect timeout',
      'etimedout',
      'econnreset',
      'econnrefused',
      'und_err_connect_timeout',
      'timeout',
    ];
    if (transientPatterns.some((pattern) => lowerMsg.includes(pattern))) {
      return { isTransient: true, status: numericStatus ?? 'TRANSIENT_ERROR' };
    }

    return { isTransient: false, status: numericStatus ?? 'UNKNOWN' };
  }

  private calculateBackoffDelay(attempt: number): number {
    if (this.baseDelayMs <= 0) return 0;
    // Exponential backoff: attempt 1 -> 1s, attempt 2 -> 2s, plus small jitter (0-200ms)
    const factor = Math.pow(2, attempt - 1);
    const jitter = Math.floor(Math.random() * 200);
    return this.baseDelayMs * factor + jitter;
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private buildContents(context: GenerativeAiPromptContext) {
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

    if (context.conversationHistory && context.conversationHistory.length > 0) {
      for (const msg of context.conversationHistory) {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }],
        });
      }
    }

    let userPromptText = '';
    if (context.contextBlocks && context.contextBlocks.length > 0) {
      userPromptText += '--- VERIFIED BUSINESS DATA CONTEXT ---\n';
      for (const block of context.contextBlocks) {
        userPromptText += `[${block.label}]:\n${block.content}\n\n`;
      }
      userPromptText += '--- USER QUESTION ---\n';
    }
    userPromptText += context.userMessage;

    contents.push({
      role: 'user',
      parts: [{ text: userPromptText }],
    });

    return contents;
  }

  private parseStructuredOutput(rawText: string): AssistantStructuredOutput {
    let cleanJson = rawText.trim();

    // Strip markdown code fences if Gemini enclosed output in ```json ... ```
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    }

    try {
      const parsed = JSON.parse(cleanJson);
      return {
        answer: typeof parsed.answer === 'string' ? parsed.answer : rawText,
        language: ['en', 'si', 'mixed'].includes(parsed.language) ? parsed.language : 'en',
        kpi_cards: Array.isArray(parsed.kpi_cards) ? parsed.kpi_cards : undefined,
        table: parsed.table && typeof parsed.table === 'object' ? parsed.table : undefined,
        chart: parsed.chart && typeof parsed.chart === 'object' ? parsed.chart : undefined,
        sources: Array.isArray(parsed.sources) ? parsed.sources : [],
        follow_up_suggestions: Array.isArray(parsed.follow_up_suggestions)
          ? parsed.follow_up_suggestions.slice(0, 3)
          : undefined,
        confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'medium',
        disclaimer: typeof parsed.disclaimer === 'string' ? parsed.disclaimer : undefined,
      };
    } catch {
      this.logger.warn('Failed to parse Gemini JSON output directly. Falling back to text response wrapper.');
      return {
        answer: rawText,
        language: 'en',
        sources: [],
        confidence: 'low',
        disclaimer: 'Response was generated without strict schema compliance.',
      };
    }
  }

  private sanitizeError(err: unknown): string {
    if (!err) return 'Unknown error';
    const message = err instanceof Error ? err.message : String(err);
    if (this.apiKey) {
      return message.replaceAll(this.apiKey, '[REDACTED_API_KEY]');
    }
    return message;
  }
}
