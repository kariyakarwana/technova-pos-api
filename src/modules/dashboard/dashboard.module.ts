import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { DashboardsController } from './dashboard/dashboards.controller';
import { DashboardsService } from './dashboard/dashboards.service';
import { DashboardTemplatesController } from './dashboard-templates/dashboard-templates.controller';
import { DashboardTemplatesService } from './dashboard-templates/dashboard-templates.service';
import { VisualThemesController } from './visual-themes/visual-themes.controller';
import { VisualThemesService } from './visual-themes/visual-themes.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [
    DashboardsController,
    DashboardTemplatesController,
    VisualThemesController,
  ],
  providers: [
    DashboardsService,
    DashboardTemplatesService,
    VisualThemesService,
  ],
  exports: [
    DashboardsService,
    DashboardTemplatesService,
    VisualThemesService,
  ],
})
export class DashboardModule {}
