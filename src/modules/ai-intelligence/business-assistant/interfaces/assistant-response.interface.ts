export interface KpiCard {
  label: string;
  value: string;
  change?: string;
  trend?: 'up' | 'down' | 'neutral';
  unit?: string;
}

export interface TableData {
  title: string;
  columns: string[];
  rows: (string | number)[][];
}

export interface ChartSeries {
  name: string;
  data: Array<{ label: string; value: number }>;
}

export interface ChartData {
  type: 'line' | 'bar' | 'pie';
  title: string;
  x_label?: string;
  y_label?: string;
  series: ChartSeries[];
}

export interface SourceReference {
  tool: string;
  entity: string;
  recordCount: number;
  timeRange?: string;
  branchId?: string;
}

export interface AssistantStructuredOutput {
  answer: string;
  language: 'en' | 'si' | 'mixed';
  kpi_cards?: KpiCard[];
  table?: TableData;
  chart?: ChartData;
  sources: SourceReference[];
  follow_up_suggestions?: string[];
  confidence: 'high' | 'medium' | 'low';
  disclaimer?: string;
}

export interface AssistantMessagePayload extends AssistantStructuredOutput {
  id: string;
  role: 'assistant';
  createdAt: string;
}

export interface AssistantChatResponseDto {
  conversationId: string;
  message: AssistantMessagePayload;
  metadata?: {
    model: string;
    tokensUsed?: number;
    degraded?: boolean;
    processingTimeMs?: number;
  };
}
