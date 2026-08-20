import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [BranchesController],
  providers: [BranchesService],
})
export class BranchesModule {}
