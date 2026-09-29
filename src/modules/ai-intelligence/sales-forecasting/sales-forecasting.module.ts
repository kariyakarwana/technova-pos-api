import { Module } from '@nestjs/common';
import { SalesDataExtractionService } from './sales-data-extraction.service';
import { SalesFeatureEngineeringService } from './sales-feature-engineering.service';

@Module({
  controllers: [],
  providers: [
    SalesDataExtractionService,
    SalesFeatureEngineeringService,
  ],
  exports: [
    SalesDataExtractionService,
    SalesFeatureEngineeringService,
  ],
})
export class SalesForecastingModule {}
