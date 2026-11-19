import { BillingLifecycleService } from './billing-lifecycle.service';
import { Global, Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { QuotaService } from './quota.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [SubscriptionsController],
  providers: [QuotaService, SubscriptionsService, BillingLifecycleService],
  exports: [QuotaService, SubscriptionsService, BillingLifecycleService],
})
export class SubscriptionsModule {}
