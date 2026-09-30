export interface ToolParameterSchema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  enum?: string[];
}

export interface ToolExecutionContext {
  userId: string;
  organizationId: string;
  branchId?: string;
  userPermissions: string[];
}

export interface ToolResultMetadata {
  recordCount?: number;
  durationMs?: number;
  source?: string;
  timeRange?: string;
  branchId?: string;
}

export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: ToolResultMetadata;
}

export interface IBusinessTool<TParams = Record<string, unknown>, TResult = unknown> {
  readonly name: string;
  readonly description: string;
  readonly requiredPermissions: string[];
  readonly parameterSchema: Record<string, ToolParameterSchema>;

  execute(params: TParams, context: ToolExecutionContext): Promise<ToolResult<TResult>>;
}
