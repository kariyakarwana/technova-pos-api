import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CustomerAppController } from './customer-app.controller';
import { CustomerAppService } from './customer-app.service';

@Module({
  imports: [AuthModule],
  controllers: [CustomerAppController],
  providers: [CustomerAppService],
})
export class CustomerAppModule {}

