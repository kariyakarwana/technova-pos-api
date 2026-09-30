/* eslint-disable @typescript-eslint/no-base-to-string, @typescript-eslint/restrict-template-expressions, no-control-regex */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { SourceReference } from '../interfaces/assistant-response.interface';
import { GENERATIVE_AI_PROVIDER } from '../providers/generative-ai-provider.interface';
import type { IGenerativeAiProvider } from '../providers/generative-ai-provider.interface';
import { formatColomboDate } from '../tools/date-utils';
import { ToolExecutionContext, ToolResult } from '../tools/business-tool.interface';
import { ToolRegistryService } from '../tools/tool-registry.service';
import { OrchestrationRequest, OrchestrationResult } from './orchestrator.types';

@Injectable()
export class BusinessAssistantOrchestrator {
  private readonly logger = new Logger(BusinessAssistantOrchestrator.name);

  constructor(
    @Inject(GENERATIVE_AI_PROVIDER)
    private readonly aiProvider: IGenerativeAiProvider,
    private readonly toolRegistry: ToolRegistryService,
  ) {}

  async orchestrate(request: OrchestrationRequest): Promise<OrchestrationResult> {
    const { message, context } = request;
    const startTime = Date.now();

    // 1. Sanitize user query
    const sanitizedQuery = this.sanitizeQuery(message);

    // 2. Discover available tools authorized for this user
    const availableTools = this.toolRegistry.getAvailableTools(context.userPermissions);

    // 3. Security check: Reject malicious SQL or unauthorized command attempts immediately
    if (this.isMaliciousQuery(sanitizedQuery)) {
      return {
        structuredOutput: {
          answer: 'Your request cannot be processed because it contains unsupported or unauthorized database instructions. The Business Assistant operates exclusively through controlled, read-only analytical tools.',
          language: 'en',
          sources: [],
          confidence: 'high',
          disclaimer: 'Security validation policy enforced.',
        },
        model: this.aiProvider.getModelName(),
        degraded: false,
      };
    }

    // 4. Determine and plan tool execution based on query intent
    const toolPlans = this.planToolExecution(sanitizedQuery, context.branchId);

    // 5. Execute authorized tools and prepare structured context blocks
    const toolExecutionContext: ToolExecutionContext = {
      userId: context.userId,
      organizationId: context.organizationId,
      branchId: context.branchId,
      userPermissions: context.userPermissions,
    };

    const contextBlocks: Array<{ label: string; content: string }> = [
      {
        label: 'ORGANIZATION_AND_SESSION_CONTEXT',
        content: JSON.stringify({
          organizationId: context.organizationId,
          branchId: context.branchId ?? 'ALL_BRANCHES',
          userRole: context.userRoles[0] ?? 'STAFF',
          currentTime: new Date().toISOString(),
          activeToolCount: availableTools.length,
          availableToolNames: availableTools.map((t) => t.name),
        }),
      },
    ];

    const collectedSources: SourceReference[] = [];
    const toolExecutions: Array<{ toolName: string; result: ToolResult }> = [];

    for (const plan of toolPlans) {
      const tool = this.toolRegistry.get(plan.toolName);
      if (!tool) continue;

      // Verify user has permission for this tool
      const hasPermission =
        context.userPermissions.includes('SUPER_ADMIN') ||
        !tool.requiredPermissions.length ||
        tool.requiredPermissions.some((perm) => context.userPermissions.includes(perm));

      if (!hasPermission) {
        contextBlocks.push({
          label: `UNAUTHORIZED_TOOL_${tool.name}`,
          content: `User lacks required permissions [${tool.requiredPermissions.join(', ')}] to execute ${tool.name}.`,
        });
        continue;
      }

      try {
        const result = await tool.execute(plan.params, toolExecutionContext);
        toolExecutions.push({ toolName: tool.name, result });

        if (result.success && result.data) {
          contextBlocks.push({
            label: `VERIFIED_${tool.name.toUpperCase()}_DATA`,
            content: JSON.stringify(result.data),
          });

          if (result.metadata) {
            collectedSources.push({
              tool: tool.name,
              entity: result.metadata.source ?? tool.name,
              recordCount: result.metadata.recordCount ?? 1,
              timeRange: result.metadata.timeRange,
              branchId: result.metadata.branchId,
            });
          }
        } else if (!result.success) {
          contextBlocks.push({
            label: `TOOL_NOTICE_${tool.name}`,
            content: `Tool reported: ${result.error ?? 'Data unavailable'}`,
          });
        }
      } catch (toolError: unknown) {
        this.logger.error(`Error executing tool ${tool.name}`, toolError);
      }
    }

    // 6. Build system prompt enforcing schema and factual grounding
    const systemPrompt = this.buildSystemPrompt(context.branchId);

    // 7. Check provider availability
    if (!this.aiProvider.isAvailable()) {
      this.logger.warn('AI Provider is not configured or unavailable. Returning rule-based degraded response.');
      return this.generateDegradedFallback(
        sanitizedQuery,
        'AI provider is not configured with an API key.',
        toolExecutions,
        collectedSources,
      );
    }

    // 8. Invoke generative AI provider with structured factual context
    try {
      const result = await this.aiProvider.generateResponse({
        systemPrompt,
        userMessage: sanitizedQuery,
        contextBlocks,
        temperature: 0.2,
      });

      const structuredOutput = result.structuredOutput ?? {
        answer: result.content,
        language: 'en',
        sources: collectedSources.length > 0 ? collectedSources : this.buildDefaultSources(context.branchId),
        confidence: 'medium',
      };

      // Ensure sources reflect real tool executions if available
      if (!structuredOutput.sources || structuredOutput.sources.length === 0) {
        structuredOutput.sources =
          collectedSources.length > 0 ? collectedSources : this.buildDefaultSources(context.branchId);
      }

      this.logger.log(
        `Orchestration completed in ${Date.now() - startTime}ms using ${result.model} (${collectedSources.length} tool sources)`,
      );

      return {
        structuredOutput,
        tokensUsed: (result.inputTokens ?? 0) + (result.outputTokens ?? 0),
        model: result.model,
        degraded: false,
      };
    } catch (err: unknown) {
      this.logger.error('Orchestration failed via generative AI provider. Falling back to degraded response.', err);
      return this.generateDegradedFallback(
        sanitizedQuery,
        'Generative AI service is temporarily unavailable. Displaying data directly from store records.',
        toolExecutions,
        collectedSources,
      );
    }
  }

  private isMaliciousQuery(query: string): boolean {
    const lower = query.toLowerCase();
    const maliciousPatterns = [
      /\bdrop\s+table\b/i,
      /\bdelete\s+from\b/i,
      /\btruncate\s+table\b/i,
      /\bselect\s+.*\s+from\s+pg_/i,
      /\bselect\s+password\b/i,
      /\bconnection_string\b/i,
      /\bunion\s+select\b/i,
    ];
    return maliciousPatterns.some((pattern) => pattern.test(lower));
  }

  private planToolExecution(
    query: string,
    branchId?: string,
  ): Array<{ toolName: string; params: Record<string, unknown> }> {
    const lower = query.toLowerCase();
    const plans: Array<{ toolName: string; params: Record<string, unknown> }> = [];

    // 0. Controlled Multi-Tool Scenarios
    // a. Demand Forecast + Low Stock Inventory
    const hasDemandIntent =
      lower.includes('demand') ||
      lower.includes('expected demand') ||
      lower.includes('predicted demand') ||
      lower.includes('high demand') ||
      lower.includes('need more stock') ||
      lower.includes('need stock');

    const hasStockIntent =
      lower.includes('low in stock') ||
      lower.includes('low stock') ||
      lower.includes('out of stock') ||
      lower.includes('running low') ||
      lower.includes('in stock');

    if (hasDemandIntent && hasStockIntent) {
      const horizon = this.extractHorizon(lower);
      plans.push({
        toolName: 'DemandForecastTool',
        params: { horizon, branchId },
      });
      plans.push({
        toolName: 'InventoryTool',
        params: { operation: 'low_stock', branchId, limit: 20 },
      });
      return plans;
    }

    // b. Sales Forecast + Recommendation
    const hasSalesForecastIntent =
      lower.includes('sales forecast') ||
      lower.includes('revenue forecast') ||
      lower.includes('expected revenue') ||
      lower.includes('expected sales') ||
      lower.includes('forecasted revenue') ||
      lower.includes('forecasted sales') ||
      lower.includes('projected revenue') ||
      lower.includes('projected sales') ||
      lower.includes('forecast is increasing') ||
      lower.includes('forecast is growing') ||
      (lower.includes('forecast') && (lower.includes('sales') || lower.includes('revenue')));

    const hasRecommendationIntent =
      lower.includes('recommend') ||
      lower.includes('recommendation') ||
      lower.includes('trending') ||
      lower.includes('bought together') ||
      lower.includes('frequently bought') ||
      lower.includes('cross sell');

    if (hasSalesForecastIntent && hasRecommendationIntent) {
      const horizon = this.extractHorizon(lower);
      plans.push({
        toolName: 'SalesForecastTool',
        params: { horizon, branchId },
      });
      plans.push({
        toolName: 'RecommendationTool',
        params: { context: 'TRENDING', topN: 5, branchId },
      });
      return plans;
    }

    // 1. Single AI Tools
    // a. Demand Forecast Tool
    if (hasDemandIntent) {
      const horizon = this.extractHorizon(lower);
      plans.push({
        toolName: 'DemandForecastTool',
        params: { horizon, branchId },
      });
      return plans;
    }

    // b. Sales Forecast Tool
    if (hasSalesForecastIntent || (lower.includes('forecast') && !lower.includes('demand'))) {
      const horizon = this.extractHorizon(lower);
      plans.push({
        toolName: 'SalesForecastTool',
        params: { horizon, branchId },
      });
      return plans;
    }

    // c. Recommendation Tool
    if (hasRecommendationIntent) {
      let context = 'TRENDING';
      if (lower.includes('bought together') || lower.includes('cart') || lower.includes('together')) {
        context = 'CART_READY';
      } else if (lower.includes('customer') || lower.includes('client') || lower.includes('shopper')) {
        context = 'CUSTOMER';
      } else if (lower.includes('similar') || lower.includes('item') || lower.includes('product')) {
        context = 'PRODUCT';
      } else if (lower.includes('branch') || lower.includes('store')) {
        context = 'BRANCH';
      } else if (lower.includes('new') || lower.includes('cold start')) {
        context = 'COLD_START';
      }

      plans.push({
        toolName: 'RecommendationTool',
        params: { context, topN: 5, branchId },
      });
      return plans;
    }

    // 2. General Business / Executive Overview
    const isGeneralBusinessQuery =
      lower.includes('business summary') ||
      lower.includes('executive summary') ||
      lower.includes('business overview') ||
      lower.includes('business health') ||
      lower.includes('business kpi') ||
      lower.includes('store kpi');

    if (isGeneralBusinessQuery) {
      let operation = 'business_summary';
      if (lower.includes('health')) operation = 'business_health';
      if (lower.includes('kpi')) operation = 'business_kpis';
      if (lower.includes('branch overview')) operation = 'branch_overview';

      plans.push({
        toolName: 'GeneralBusinessTool',
        params: { operation },
      });
      return plans;
    }

    // 3. Customers
    const isCustomerQuery =
      lower.includes('customer') ||
      lower.includes('customers') ||
      lower.includes('shopper') ||
      lower.includes('client');

    if (isCustomerQuery) {
      let operation = 'customer_summary';
      if (lower.includes('spend') || lower.includes('purchase history') || lower.includes('bought')) {
        operation = 'customer_purchase_summary';
      } else if (lower.includes('top customer') || lower.includes('best customer') || lower.includes('top spender')) {
        operation = 'customer_activity';
      } else if (lower.includes('search customer') || lower.includes('find customer')) {
        operation = 'customer_search';
      }

      plans.push({
        toolName: 'CustomersTool',
        params: { operation, limit: 10 },
      });
      return plans;
    }

    // 4. Branches
    const isBranchQuery =
      (lower.includes('branch') || lower.includes('branches') || lower.includes('location')) &&
      !lower.includes('by branch');

    if (isBranchQuery) {
      let operation = 'branch_list';
      if (lower.includes('summary') || lower.includes('how many branches')) {
        operation = 'branch_summary';
      } else if (lower.includes('detail') || lower.includes('info on branch')) {
        operation = 'branch_details';
      } else if (lower.includes('compare') || lower.includes('comparison')) {
        operation = 'branch_comparison_context';
      }

      plans.push({
        toolName: 'BranchesTool',
        params: { operation, branchId },
      });
      return plans;
    }

    // 5. Products / Catalog
    const isProductCatalogQuery =
      lower.includes('product') ||
      lower.includes('products') ||
      lower.includes('catalog') ||
      lower.includes('category') ||
      lower.includes('categories') ||
      lower.includes('pricing') ||
      lower.includes('margin') ||
      lower.includes('sku') ||
      lower.includes('barcode');

    if (
      isProductCatalogQuery &&
      !lower.includes('stock') &&
      !lower.includes('inventory') &&
      !lower.includes('sold') &&
      !lower.includes('selling') &&
      !lower.includes('sales')
    ) {
      let operation = 'product_summary';
      if (lower.includes('search') || lower.includes('find')) {
        operation = 'product_search';
      } else if (lower.includes('price') || lower.includes('pricing') || lower.includes('margin')) {
        operation = 'product_pricing';
      } else if (lower.includes('active')) {
        operation = 'active_products';
      } else if (lower.includes('detail')) {
        operation = 'product_details';
      }

      plans.push({
        toolName: 'ProductsTool',
        params: { operation, limit: 20 },
      });
      return plans;
    }

    // 6. Sales
    const isSalesQuery =
      lower.includes('sale') ||
      lower.includes('revenue') ||
      lower.includes('income') ||
      lower.includes('order') ||
      lower.includes('sold') ||
      lower.includes('turnover') ||
      lower.includes('discount') ||
      lower.includes('top product') ||
      lower.includes('best selling') ||
      lower.includes('worst selling');

    if (isSalesQuery) {
      let operation = 'summary';
      if (
        lower.includes('top product') ||
        lower.includes('best selling') ||
        lower.includes('worst selling') ||
        lower.includes('by product') ||
        lower.includes('most sold')
      ) {
        operation = 'by_product';
      } else if (lower.includes('by branch') || lower.includes('branch sales') || lower.includes('across branches')) {
        operation = 'by_branch';
      } else if (lower.includes('compare') || lower.includes('comparison') || lower.includes('vs') || lower.includes('growth')) {
        operation = 'comparison';
      } else if (lower.includes('trend') || lower.includes('daily') || lower.includes('timeline')) {
        operation = 'trend';
      }

      const { dateFrom, dateTo } = this.extractDateHints(lower);

      plans.push({
        toolName: 'SalesTool',
        params: {
          operation,
          dateFrom,
          dateTo,
          branchId,
          limit: 10,
        },
      });
    }

    // 7. Inventory
    const isInventoryQuery =
      lower.includes('stock') ||
      lower.includes('inventory') ||
      lower.includes('quantity') ||
      lower.includes('reorder') ||
      lower.includes('out of stock') ||
      lower.includes('low stock') ||
      lower.includes('on hand') ||
      lower.includes('available') ||
      lower.includes('units left');

    if (isInventoryQuery && plans.length === 0) {
      let operation = 'summary';
      if (lower.includes('low stock') || lower.includes('running low') || lower.includes('reorder level')) {
        operation = 'low_stock';
      } else if (lower.includes('out of stock') || lower.includes('zero stock') || lower.includes('depleted')) {
        operation = 'out_of_stock';
      } else if (lower.includes('by branch') || lower.includes('across branches') || lower.includes('branch stock')) {
        operation = 'by_branch';
      }

      plans.push({
        toolName: 'InventoryTool',
        params: {
          operation,
          branchId,
          limit: 20,
        },
      });
    }

    // Default to general business overview if no specific match
    if (plans.length === 0) {
      plans.push({
        toolName: 'GeneralBusinessTool',
        params: { operation: 'business_summary' },
      });
    }

    return plans;
  }

  private extractHorizon(lowerQuery: string): number {
    if (lowerQuery.includes('30 days') || lowerQuery.includes('next month') || lowerQuery.includes('one month') || lowerQuery.includes('month')) {
      return 30;
    }
    if (lowerQuery.includes('14 days') || lowerQuery.includes('2 weeks') || lowerQuery.includes('two weeks')) {
      return 14;
    }
    if (lowerQuery.includes('tomorrow') || lowerQuery.includes('next day') || lowerQuery.includes('1 day') || lowerQuery.includes('one day')) {
      return 1;
    }
    return 7;
  }

  private extractDateHints(lowerQuery: string): { dateFrom?: string; dateTo?: string } {
    const now = new Date();
    const todayStr = formatColomboDate(now);

    if (lowerQuery.includes('today')) {
      return { dateFrom: todayStr, dateTo: todayStr };
    }

    if (lowerQuery.includes('yesterday')) {
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const yestStr = formatColomboDate(yesterday);
      return { dateFrom: yestStr, dateTo: yestStr };
    }

    if (lowerQuery.includes('this week') || lowerQuery.includes('past 7 days') || lowerQuery.includes('last 7 days')) {
      const past7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return { dateFrom: formatColomboDate(past7), dateTo: todayStr };
    }

    if (lowerQuery.includes('this month') || lowerQuery.includes('past 30 days') || lowerQuery.includes('last 30 days')) {
      const past30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return { dateFrom: formatColomboDate(past30), dateTo: todayStr };
    }

    return {};
  }

  private buildSystemPrompt(branchId?: string): string {
    return `You are the TechNova POS Business Assistant, an expert business analyst for retail store operations.
Current system mode: Phase 5 AI Intelligence & Business Data Tools Active (Sales, Inventory, Products, Branches, Customers, GeneralBusiness, SalesForecast, DemandForecast, Recommendation).

CRITICAL INSTRUCTIONS:
1. Ground all answers strictly and exclusively in the provided VERIFIED_*_DATA context blocks.
2. NEVER hallucinate, guess, or invent numbers, sales metrics, customer profiles, product quantities, or forecast numbers.
3. If an AI forecasting or recommendation service reports "available": false, explicitly state that the AI predictive service is temporarily offline or unavailable, and NEVER fabricate forecast values.
4. If data is not present in the verified context blocks, explicitly state that the metric is not found in the current store records.
5. Always populate "kpi_cards" with the primary metrics discussed in your answer.
6. If table or list data is present (e.g. products, customers, branches, forecast timelines, recommendations), populate the "table" and/or "chart" fields.
7. The active branch filter is: ${branchId ? `Branch ID: ${branchId}` : 'All Store Branches'}.
8. Customer Privacy: Customer phone numbers, emails, and addresses are strictly excluded and must never appear in answers.
9. Return your response exclusively as a valid JSON object matching this TypeScript structure:
{
  "answer": "string (Markdown formatted narrative)",
  "language": "en" | "si" | "mixed",
  "kpi_cards": [{"label": "string", "value": "string", "change": "string", "trend": "up"|"down"|"neutral", "unit": "string"}],
  "table": {"title": "string", "columns": ["string"], "rows": [["string"]]},
  "chart": {
    "type": "line" | "bar" | "pie",
    "title": "string",
    "series": [{"name": "string", "data": [{"label": "string", "value": 123}]}]
  },
  "sources": [{"tool": "string", "entity": "string", "recordCount": 1}],
  "follow_up_suggestions": ["string", "string"],
  "confidence": "high" | "medium" | "low",
  "disclaimer": "string"
}`;
  }

  private sanitizeQuery(query: string): string {
    return query
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/===+/g, '==')
      .replace(/---+/g, '--')
      .trim();
  }

  private buildDefaultSources(branchId?: string): SourceReference[] {
    return [
      {
        tool: 'SystemFoundation',
        entity: 'AssistantContext',
        recordCount: 1,
        branchId,
      },
    ];
  }

  private generateDegradedFallback(
    query: string,
    reason: string,
    toolExecutions: Array<{ toolName: string; result: ToolResult }>,
    sources: SourceReference[],
  ): OrchestrationResult {
    let answer = `I received your question: "${query}".\n\n**Notice:** ${reason}\n\n`;

    const successfulExecs = toolExecutions.filter((e) => e.result.success && e.result.data);

    if (successfulExecs.length > 0) {
      answer += '### Verified Store Data Summary\n\n';
      for (const exec of successfulExecs) {
        const data = exec.result.data as Record<string, unknown>;

        if (exec.toolName === 'SalesTool' && data.totalRevenue !== undefined) {
          answer += `- **Total Revenue:** $${data.totalRevenue}\n`;
          answer += `- **Transactions:** ${data.transactionCount}\n`;
          answer += `- **Average Order Value:** $${data.averageTransactionValue}\n\n`;
        } else if (exec.toolName === 'InventoryTool' && data.totalActiveProducts !== undefined) {
          answer += `- **Active Catalog Products:** ${data.totalActiveProducts}\n`;
          answer += `- **Units on Hand:** ${data.totalUnitsOnHand}\n`;
          answer += `- **Low Stock Items:** ${data.lowStockItemsCount}\n\n`;
        } else if (exec.toolName === 'ProductsTool' && data.totalProducts !== undefined) {
          answer += `- **Total Products in Catalog:** ${data.totalProducts}\n`;
          answer += `- **Active Products:** ${data.activeProducts}\n`;
          answer += `- **Average Selling Price:** $${data.averageSellingPrice}\n\n`;
        } else if (exec.toolName === 'BranchesTool' && data.totalBranches !== undefined) {
          answer += `- **Total Branches:** ${data.totalBranches}\n`;
          answer += `- **Active Branches:** ${data.activeBranches}\n\n`;
        } else if (exec.toolName === 'CustomersTool' && data.totalCustomers !== undefined) {
          answer += `- **Total Registered Customers:** ${data.totalCustomers}\n`;
          answer += `- **Active Customers:** ${data.activeCustomers}\n\n`;
        } else if (exec.toolName === 'GeneralBusinessTool') {
          answer += `- **General Business Snapshot compiled successfully.**\n\n`;
        } else if (exec.toolName === 'SalesForecastTool') {
          if (data.available === false) {
            answer += `- **Sales Forecast:** Service currently unavailable (${data.reason ?? 'AI service offline'}).\n\n`;
          } else {
            answer += `- **Sales Forecast (${data.horizon ?? 7} Days):** Predicted Revenue: $${data.total_predicted_revenue ?? 0} (Avg/Day: $${data.average_daily_revenue ?? 0})\n\n`;
          }
        } else if (exec.toolName === 'DemandForecastTool') {
          if (data.available === false) {
            answer += `- **Demand Forecast:** Service currently unavailable (${data.reason ?? 'AI service offline'}).\n\n`;
          } else {
            answer += `- **Demand Forecast (${data.horizon ?? 7} Days):** Predicted Units: ${data.total_predicted_units ?? 0} (Avg/Day: ${data.average_daily_units ?? 0})\n\n`;
          }
        } else if (exec.toolName === 'RecommendationTool') {
          if (data.available === false) {
            answer += `- **Recommendations:** Service currently unavailable (${data.reason ?? 'AI service offline'}).\n\n`;
          } else {
            const recs = (data.recommendations as Array<{ name?: string; score?: number }>) ?? [];
            answer += `- **Product Recommendations (${data.context ?? 'TRENDING'}):** ${recs.length} items suggested.\n\n`;
          }
        }
      }
    }

    return {
      structuredOutput: {
        answer,
        language: 'en',
        sources: sources.length > 0 ? sources : [{ tool: 'FallbackEngine', entity: 'SystemNotice', recordCount: 1 }],
        confidence: successfulExecs.length > 0 ? 'medium' : 'low',
        disclaimer: 'This response was synthesized from local database records without LLM formatting.',
        follow_up_suggestions: [
          'What are our top selling products?',
          'Which products are low on stock?',
          'Give me a business summary',
        ],
      },
      model: this.aiProvider.getModelName(),
      degraded: true,
    };
  }
}
