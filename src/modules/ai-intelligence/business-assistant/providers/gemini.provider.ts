import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AssistantStructuredOutput,
  ChartData,
  KpiCard,
  SourceReference,
  TableData,
} from '../interfaces/assistant-response.interface';
import {
  GenerativeAiPromptContext,
  GenerativeAiResult,
  IGenerativeAiProvider,
} from './generative-ai-provider.interface';

type GeminiContent = { role: 'user' | 'model'; parts: Array<{ text: string }> };
type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { code?: number; message?: string; status?: string };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

@Injectable()
export class GeminiProvider implements IGenerativeAiProvider {
  private readonly logger = new Logger(GeminiProvider.name);
  private readonly apiKey: string | null;
  private readonly primaryModel: string;
  private readonly fallbackModel: string;
  private readonly maxPrimaryAttempts = 3;
  private readonly maxFallbackAttempts = 2;
  private readonly baseDelayMs: number;

  constructor(config: ConfigService) {
    const rawKey = config.get<string>('GEMINI_API_KEY');
    this.apiKey = rawKey?.trim() || null;
    this.primaryModel = config.get<string>('GEMINI_MODEL') || 'gemini-3.8-flash';
    this.fallbackModel =
      config.get<string>('GEMINI_FALLBACK_MODEL') || 'gemini-3.5-flash';
    const configuredDelay = config.get<string | number>(
      'GEMINI_RETRY_BASE_DELAY_MS',
    );
    this.baseDelayMs =
      configuredDelay === undefined || configuredDelay === null
        ? process.env.NODE_ENV === 'test'
          ? 0
          : 1000
        : Math.max(Number(configuredDelay) || 0, 0);

    if (this.apiKey) {
      this.logger.log(
        `Gemini provider configured with primary model "${this.primaryModel}".`,
      );
    } else {
      this.logger.warn(
        'GEMINI_API_KEY is not configured. Business Assistant will run in degraded mode.',
      );
    }
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  getModelName(): string {
    return this.primaryModel;
  }

  getFallbackModelName(): string {
    return this.fallbackModel;
  }

  async generateResponse(
    context: GenerativeAiPromptContext,
  ): Promise<GenerativeAiResult> {
    if (!this.apiKey) {
      throw new ServiceUnavailableException(
        'Gemini API is not configured. Set GEMINI_API_KEY in the backend environment.',
      );
    }

    const contents = this.buildContents(context);
    try {
      return await this.executeWithModel(
        this.primaryModel,
        this.maxPrimaryAttempts,
        contents,
        context,
      );
    } catch (primaryError: unknown) {
      if (primaryError instanceof ServiceUnavailableException) throw primaryError;
      const classification = this.classifyError(primaryError);
      if (
        !classification.isTransient ||
        !this.fallbackModel ||
        this.fallbackModel === this.primaryModel
      ) {
        this.logger.error(
          `Gemini primary model failed (${classification.status}).`,
          this.sanitizeError(primaryError),
        );
        throw new BadGatewayException(
          'The generative AI service could not complete the request.',
        );
      }

      this.logger.warn(
        `Gemini primary model is temporarily unavailable; trying "${this.fallbackModel}".`,
      );
      try {
        return await this.executeWithModel(
          this.fallbackModel,
          this.maxFallbackAttempts,
          contents,
          context,
        );
      } catch (fallbackError: unknown) {
        this.logger.error(
          'Gemini fallback model failed.',
          this.sanitizeError(fallbackError),
        );
        throw new BadGatewayException(
          'The generative AI service could not complete the request.',
        );
      }
    }
  }

  private async executeWithModel(
    modelName: string,
    maxAttempts: number,
    contents: GeminiContent[],
    context: GenerativeAiPromptContext,
  ): Promise<GenerativeAiResult> {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const endpoint =
          `https://generativelanguage.googleapis.com/v1beta/models/` +
          `${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(this.apiKey!)}`;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: context.systemPrompt }] },
            contents,
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: context.temperature ?? 0.2,
              maxOutputTokens: context.maxOutputTokens ?? 2048,
            },
          }),
          signal: AbortSignal.timeout(30_000),
        });
        const payload = (await response.json().catch(() => ({}))) as GeminiResponse;
        if (!response.ok) {
          const error = new Error(
            payload.error?.message || `Gemini API returned ${response.status}.`,
          ) as Error & { status?: number };
          error.status = response.status;
          throw error;
        }

        const rawText =
          payload.candidates?.[0]?.content?.parts
            ?.map((part) => part.text ?? '')
            .join('') ?? '';
        if (!rawText) throw new Error('Gemini returned an empty response.');
        return {
          content: rawText,
          structuredOutput: this.parseStructuredOutput(rawText),
          inputTokens: payload.usageMetadata?.promptTokenCount,
          outputTokens: payload.usageMetadata?.candidatesTokenCount,
          model: modelName,
        };
      } catch (error: unknown) {
        const classification = this.classifyError(error);
        if (!classification.isTransient || attempt >= maxAttempts) throw error;
        const delay = this.calculateBackoffDelay(attempt);
        if (delay > 0) await this.sleep(delay);
      }
    }
    throw new BadGatewayException('The generative AI service is unavailable.');
  }

  private classifyError(error: unknown): {
    isTransient: boolean;
    status: number | string;
  } {
    const record = isRecord(error) ? error : {};
    const rawStatus = record.status ?? record.statusCode ?? record.code;
    const message = errorMessage(error);
    const match = message.match(/\b(400|401|403|404|408|429|500|502|503|504)\b/);
    const status =
      typeof rawStatus === 'number'
        ? rawStatus
        : typeof rawStatus === 'string' && /^\d{3}$/.test(rawStatus)
          ? Number(rawStatus)
          : match
            ? Number(match[1])
            : undefined;
    if (status && [400, 401, 403, 404].includes(status)) {
      return { isTransient: false, status };
    }
    if (status && [408, 429, 500, 502, 503, 504].includes(status)) {
      return { isTransient: true, status };
    }
    const lower = message.toLowerCase();
    const transient = [
      'unavailable',
      'resource_exhausted',
      'deadline_exceeded',
      'timeout',
      'fetch failed',
      'econnreset',
      'econnrefused',
    ].some((pattern) => lower.includes(pattern));
    return { isTransient: transient, status: status ?? 'UNKNOWN' };
  }

  private calculateBackoffDelay(attempt: number): number {
    return this.baseDelayMs <= 0
      ? 0
      : this.baseDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 200);
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private buildContents(context: GenerativeAiPromptContext): GeminiContent[] {
    const contents: GeminiContent[] = (context.conversationHistory ?? []).map(
      (message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      }),
    );
    const contextText = (context.contextBlocks ?? [])
      .map((block) => `[${block.label}]:\n${block.content}`)
      .join('\n\n');
    contents.push({
      role: 'user',
      parts: [
        {
          text: contextText
            ? `--- VERIFIED BUSINESS DATA CONTEXT ---\n${contextText}\n\n--- USER QUESTION ---\n${context.userMessage}`
            : context.userMessage,
        },
      ],
    });
    return contents;
  }

  private parseStructuredOutput(rawText: string): AssistantStructuredOutput {
    const cleanJson = rawText
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    try {
      const parsed: unknown = JSON.parse(cleanJson) as unknown;
      if (!isRecord(parsed)) throw new Error('Expected an object.');
      const language = parsed.language;
      const confidence = parsed.confidence;
      return {
        answer: stringValue(parsed.answer) ?? rawText,
        language: language === 'si' || language === 'mixed' ? language : 'en',
        kpi_cards: Array.isArray(parsed.kpi_cards)
          ? (parsed.kpi_cards.filter(isRecord) as unknown as KpiCard[])
          : undefined,
        table: isRecord(parsed.table) ? (parsed.table as unknown as TableData) : undefined,
        chart: isRecord(parsed.chart) ? (parsed.chart as unknown as ChartData) : undefined,
        sources: Array.isArray(parsed.sources)
          ? (parsed.sources.filter(isRecord) as unknown as SourceReference[])
          : [],
        follow_up_suggestions: Array.isArray(parsed.follow_up_suggestions)
          ? parsed.follow_up_suggestions
              .filter((value): value is string => typeof value === 'string')
              .slice(0, 3)
          : undefined,
        confidence:
          confidence === 'high' || confidence === 'low' ? confidence : 'medium',
        disclaimer: stringValue(parsed.disclaimer),
      };
    } catch {
      return {
        answer: rawText,
        language: 'en',
        sources: [],
        confidence: 'low',
        disclaimer: 'Response was generated without strict schema compliance.',
      };
    }
  }

  private sanitizeError(error: unknown): string {
    const message = errorMessage(error);
    return this.apiKey
      ? message.replaceAll(this.apiKey, '[REDACTED_API_KEY]')
      : message;
  }
}
