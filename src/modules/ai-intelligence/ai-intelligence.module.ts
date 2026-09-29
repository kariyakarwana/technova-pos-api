import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SalesDataExtractionService } from './sales-forecasting/sales-data-extraction.service';
import { AiIntelligenceController } from './ai-intelligence.controller';
import { AiIntelligenceService } from './ai-intelligence.service';

import { BusinessAssistantModule } from './business-assistant/business-assistant.module';
import { DemandDataExtractionService } from './demand-data-extraction.service';

@Module({
  imports: [AuthModule, forwardRef(() => BusinessAssistantModule)],
  controllers: [AiIntelligenceController],
  providers: [
    AiIntelligenceService,
    SalesDataExtractionService,
    DemandDataExtractionService,
  ],
  exports: [BusinessAssistantModule, AiIntelligenceService],
})
export class AiIntelligenceModule {}

