import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AiIntelligenceController } from './ai-intelligence.controller';
import { AiIntelligenceService } from './ai-intelligence.service';

@Module({
  imports: [AuthModule],
  controllers: [AiIntelligenceController],
  providers: [AiIntelligenceService],
})
export class AiIntelligenceModule {}
