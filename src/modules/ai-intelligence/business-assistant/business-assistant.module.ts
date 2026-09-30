import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { AiIntelligenceModule } from '../ai-intelligence.module';
import { BusinessAssistantController } from './business-assistant.controller';
import { BusinessAssistantService } from './business-assistant.service';
import { BusinessAssistantOrchestrator } from './orchestrator/business-assistant.orchestrator';
import { GeminiProvider } from './providers/gemini.provider';
import { GENERATIVE_AI_PROVIDER } from './providers/generative-ai-provider.interface';
import { BranchesTool } from './tools/branches.tool';
import { CustomersTool } from './tools/customers.tool';
import { DemandForecastTool } from './tools/demand-forecast.tool';
import { GeneralBusinessTool } from './tools/general-business.tool';
import { InventoryTool } from './tools/inventory.tool';
import { ProductsTool } from './tools/products.tool';
import { RecommendationTool } from './tools/recommendation.tool';
import { SalesForecastTool } from './tools/sales-forecast.tool';
import { SalesTool } from './tools/sales.tool';
import { ToolRegistryService } from './tools/tool-registry.service';

@Module({
  imports: [AuthModule, forwardRef(() => AiIntelligenceModule)],
  controllers: [BusinessAssistantController],
  providers: [
    BusinessAssistantService,
    BusinessAssistantOrchestrator,
    ToolRegistryService,
    SalesTool,
    InventoryTool,
    ProductsTool,
    BranchesTool,
    CustomersTool,
    GeneralBusinessTool,
    SalesForecastTool,
    DemandForecastTool,
    RecommendationTool,
    GeminiProvider,
    {
      provide: GENERATIVE_AI_PROVIDER,
      useExisting: GeminiProvider,
    },
  ],
  exports: [
    BusinessAssistantService,
    BusinessAssistantOrchestrator,
    ToolRegistryService,
    SalesTool,
    InventoryTool,
    ProductsTool,
    BranchesTool,
    CustomersTool,
    GeneralBusinessTool,
    SalesForecastTool,
    DemandForecastTool,
    RecommendationTool,
    GeminiProvider,
    GENERATIVE_AI_PROVIDER,
  ],
})
export class BusinessAssistantModule {}
