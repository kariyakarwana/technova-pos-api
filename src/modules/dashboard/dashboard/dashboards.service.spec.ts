/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DashboardsService } from './dashboards.service';
import { DashboardTemplatesService } from '../dashboard-templates/dashboard-templates.service';
import { VisualThemesService } from '../visual-themes/visual-themes.service';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';

type MockMethod = jest.Mock<
  Promise<Record<string, unknown> | Record<string, unknown>[] | null>,
  unknown[]
>;

interface MockPrisma {
  organizationUser: {
    findFirst: MockMethod;
  };
  branch: {
    findFirst: MockMethod;
  };
  dashboard: {
    findMany: MockMethod;
    findFirst: MockMethod;
    count: jest.Mock<Promise<number>, unknown[]>;
    create: MockMethod;
    update: MockMethod;
    delete: MockMethod;
    updateMany: MockMethod;
  };
  dashboardTemplate: {
    findMany: MockMethod;
    findFirst: MockMethod;
    count: jest.Mock<Promise<number>, unknown[]>;
    create: MockMethod;
    update: MockMethod;
    delete: MockMethod;
  };
  visualTheme: {
    findMany: MockMethod;
    findFirst: MockMethod;
    count: jest.Mock<Promise<number>, unknown[]>;
    create: MockMethod;
    update: MockMethod;
    updateMany: MockMethod;
    delete: MockMethod;
  };
  $transaction: jest.Mock;
}

describe('Dashboard Services Unit Tests', () => {
  let dashboardsService: DashboardsService;
  let templatesService: DashboardTemplatesService;
  let themesService: VisualThemesService;

  const mockPrisma: MockPrisma = {
    organizationUser: {
      findFirst: jest.fn(),
    },
    branch: {
      findFirst: jest.fn(),
    },
    dashboard: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      updateMany: jest.fn(),
    },
    dashboardTemplate: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    visualTheme: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn((callbackOrArr: unknown) => {
      if (typeof callbackOrArr === 'function') {
        return (callbackOrArr as (prisma: MockPrisma) => unknown)(mockPrisma);
      }
      return Promise.all(callbackOrArr as Promise<unknown>[]);
    }),
  };

  const mockAudit = {
    record: jest.fn().mockResolvedValue(undefined),
  };

  const testUserA: AuthenticatedUser = {
    id: 'user-a',
    email: 'user.a@test.com',
    name: 'User A',
    roles: ['ADMIN'],
    permissions: ['dashboard:view', 'dashboard:customize'],
  };

  const testUserB: AuthenticatedUser = {
    id: 'user-b',
    email: 'user.b@test.com',
    name: 'User B',
    roles: ['CASHIER'],
    permissions: ['dashboard:view', 'dashboard:customize'],
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardsService,
        DashboardTemplatesService,
        VisualThemesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    dashboardsService = module.get<DashboardsService>(DashboardsService);
    templatesService = module.get<DashboardTemplatesService>(
      DashboardTemplatesService,
    );
    themesService = module.get<VisualThemesService>(VisualThemesService);
  });

  describe('DashboardsService - Organization & User Isolation', () => {
    it('should throw NotFoundException if user has no organization', async () => {
      mockPrisma.organizationUser.findFirst.mockResolvedValue(null);

      await expect(
        dashboardsService.list(testUserA, { page: 1, pageSize: 20, skip: 0 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should scope list queries strictly to authenticated user.id and organizationId', async () => {
      mockPrisma.organizationUser.findFirst.mockResolvedValue({
        organizationId: 'org-alpha',
      });
      mockPrisma.dashboard.count.mockResolvedValue(1);
      mockPrisma.dashboard.findMany.mockResolvedValue([]);

      const result = await dashboardsService.list(testUserA, {
        page: 1,
        pageSize: 20,
        skip: 0,
        userId: testUserB.id, // Attempt to query user-b
      });

      // Must be scoped strictly to user-a and org-alpha, ignoring query.userId
      expect(mockPrisma.dashboard.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: 'org-alpha',
            userId: 'user-a',
          }),
        }),
      );
      expect(result.data).toEqual([]);
    });

    it('should auto-initialize personal default dashboard for a new user with no dashboard', async () => {
      mockPrisma.organizationUser.findFirst.mockResolvedValue({
        organizationId: 'org-alpha',
      });
      mockPrisma.dashboard.count.mockResolvedValue(0);

      const createdDefault = {
        id: 'dash-init',
        organizationId: 'org-alpha',
        userId: 'user-a',
        branchId: null,
        name: 'My Dashboard',
        isDefault: true,
        layout: { version: 1, columns: 12, rowHeight: 80, widgets: [] },
      };
      mockPrisma.dashboard.create.mockResolvedValue(createdDefault);

      const result = await dashboardsService.list(testUserA, {
        page: 1,
        pageSize: 1,
        skip: 0,
        isDefault: true,
      });

      expect(mockPrisma.dashboard.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: 'org-alpha',
            userId: 'user-a',
            isDefault: true,
          }),
        }),
      );
      expect(result.data).toEqual([createdDefault]);
    });

    it('should fall back to existing organization default dashboard where userId is null when user has no personal dashboard', async () => {
      mockPrisma.organizationUser.findFirst.mockResolvedValue({
        organizationId: 'org-alpha',
      });
      mockPrisma.branch.findFirst.mockResolvedValue({
        id: 'branch-1',
        organizationId: 'org-alpha',
      });
      // User has 0 personal dashboards
      mockPrisma.dashboard.count.mockResolvedValue(0);

      const legacyDefault = {
        id: 'dash-legacy',
        organizationId: 'org-alpha',
        userId: null,
        branchId: 'branch-1',
        name: 'My Dashboard',
        isDefault: true,
        layout: {
          version: 1,
          columns: 12,
          rowHeight: 80,
          widgets: [{ id: 'w1', type: 'kpi', position: { x: 0, y: 0, w: 12, h: 4 }, settings: {} }],
        },
      };

      // Fallback findMany returns the legacy dashboard
      mockPrisma.dashboard.findMany.mockResolvedValue([legacyDefault]);

      const result = await dashboardsService.list(testUserA, {
        page: 1,
        pageSize: 1,
        skip: 0,
        branchId: 'branch-1',
        isDefault: true,
      });

      // Does not create duplicate
      expect(mockPrisma.dashboard.create).not.toHaveBeenCalled();
      expect(result.data).toEqual([legacyDefault]);
    });

    it('should fork personal dashboard when updating layout of a fallback dashboard with userId null', async () => {
      mockPrisma.organizationUser.findFirst.mockResolvedValue({
        organizationId: 'org-alpha',
      });

      const legacyDefault = {
        id: 'dash-legacy',
        organizationId: 'org-alpha',
        userId: null,
        branchId: 'branch-1',
        name: 'My Dashboard',
        description: 'Original legacy dashboard',
        isDefault: true,
        layout: { version: 1, columns: 12, rowHeight: 80, widgets: [] },
      };

      mockPrisma.dashboard.findFirst.mockResolvedValue(legacyDefault);

      const forkedPersonal = {
        id: 'dash-personal-forked',
        organizationId: 'org-alpha',
        userId: 'user-a',
        branchId: 'branch-1',
        name: 'My Dashboard',
        description: 'Original legacy dashboard',
        isDefault: true,
        layout: {
          version: 1,
          columns: 12,
          rowHeight: 80,
          widgets: [{ id: 'w-custom', type: 'chart', position: { x: 0, y: 0, w: 6, h: 4 }, settings: {} }],
        },
      };

      mockPrisma.dashboard.create.mockResolvedValue(forkedPersonal);

      const updated = await dashboardsService.updateLayout(testUserA, 'dash-legacy', {
        layout: forkedPersonal.layout,
      });

      // Legacy dashboard must NOT be updated
      expect(mockPrisma.dashboard.update).not.toHaveBeenCalled();
      // Personal dashboard must be created
      expect(mockPrisma.dashboard.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: 'org-alpha',
            userId: 'user-a',
            branchId: 'branch-1',
            isDefault: true,
          }),
        }),
      );
      expect(updated.id).toBe('dash-personal-forked');
      expect(updated.userId).toBe('user-a');
    });

    it('should prevent deleting an organization default dashboard where userId is null', async () => {
      mockPrisma.organizationUser.findFirst.mockResolvedValue({
        organizationId: 'org-alpha',
      });
      mockPrisma.dashboard.findFirst.mockResolvedValue({
        id: 'dash-legacy',
        organizationId: 'org-alpha',
        userId: null,
        name: 'Shared Dashboard',
      });

      await expect(dashboardsService.delete(testUserA, 'dash-legacy')).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.dashboard.delete).not.toHaveBeenCalled();
    });

    it('should reject creating a dashboard with a branch from a different organization', async () => {
      mockPrisma.organizationUser.findFirst.mockResolvedValue({
        organizationId: 'org-alpha',
      });
      mockPrisma.branch.findFirst.mockResolvedValue(null);

      await expect(
        dashboardsService.create(testUserA, {
          name: 'Branch Dashboard',
          branchId: 'foreign-branch',
          layout: { version: 1, columns: 12, rowHeight: 80, widgets: [] },
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should enforce authenticated user ownership and ignore client-provided dto.userId on create', async () => {
      mockPrisma.organizationUser.findFirst.mockResolvedValue({
        organizationId: 'org-alpha',
      });
      mockPrisma.dashboard.findFirst.mockResolvedValue(null);
      mockPrisma.dashboard.create.mockResolvedValue({
        id: 'dash-new',
        organizationId: 'org-alpha',
        userId: 'user-a',
        name: 'My Dashboard',
        layout: { version: 1, columns: 12, rowHeight: 80, widgets: [] },
      });

      await dashboardsService.create(testUserA, {
        name: 'My Dashboard',
        userId: testUserB.id, // Spoof attempt
        layout: { version: 1, columns: 12, rowHeight: 80, widgets: [] },
      });

      expect(mockPrisma.dashboard.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: 'org-alpha',
            userId: 'user-a', // Overridden to authenticated user-a
          }),
        }),
      );
    });

    it('should prevent duplicate default dashboards on create by updating the existing one', async () => {
      mockPrisma.organizationUser.findFirst.mockResolvedValue({
        organizationId: 'org-alpha',
      });
      const existing = {
        id: 'dash-existing-default',
        organizationId: 'org-alpha',
        userId: 'user-a',
        branchId: null,
        name: 'My Dashboard',
        isDefault: true,
      };
      mockPrisma.dashboard.findFirst.mockResolvedValue(existing);
      mockPrisma.dashboard.update.mockResolvedValue({
        ...existing,
        name: 'Updated Dashboard',
      });

      const result = await dashboardsService.create(testUserA, {
        name: 'Updated Dashboard',
        isDefault: true,
        layout: { version: 1, columns: 12, rowHeight: 80, widgets: [] },
      });

      expect(mockPrisma.dashboard.create).not.toHaveBeenCalled();
      expect(mockPrisma.dashboard.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'dash-existing-default' },
        }),
      );
      expect(result.id).toBe('dash-existing-default');
    });

    it('Security Scenario A: User A requesting User B dashboard should be denied (NotFoundException)', async () => {
      mockPrisma.organizationUser.findFirst.mockResolvedValue({
        organizationId: 'org-alpha',
      });
      mockPrisma.dashboard.findFirst.mockResolvedValue({
        id: 'dash-b',
        organizationId: 'org-alpha',
        userId: testUserB.id, // Belongs to User B
        name: "User B's Dashboard",
      });

      await expect(
        dashboardsService.detail(testUserA, 'dash-b'),
      ).rejects.toThrow(NotFoundException);
    });

    it('Security Scenario B: User A updating User B dashboard should be rejected (ForbiddenException)', async () => {
      mockPrisma.organizationUser.findFirst.mockResolvedValue({
        organizationId: 'org-alpha',
      });
      mockPrisma.dashboard.findFirst.mockResolvedValue({
        id: 'dash-b',
        organizationId: 'org-alpha',
        userId: testUserB.id, // Belongs to User B
        name: "User B's Dashboard",
      });

      await expect(
        dashboardsService.update(testUserA, 'dash-b', {
          name: 'Tampered Name',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Security Scenario C: User A deleting User B dashboard should be rejected (ForbiddenException)', async () => {
      mockPrisma.organizationUser.findFirst.mockResolvedValue({
        organizationId: 'org-alpha',
      });
      mockPrisma.dashboard.findFirst.mockResolvedValue({
        id: 'dash-b',
        organizationId: 'org-alpha',
        userId: testUserB.id,
        name: "User B's Dashboard",
      });

      await expect(
        dashboardsService.delete(testUserA, 'dash-b'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Security Scenario E: User A updating layout of User B dashboard should be rejected (ForbiddenException)', async () => {
      mockPrisma.organizationUser.findFirst.mockResolvedValue({
        organizationId: 'org-alpha',
      });
      mockPrisma.dashboard.findFirst.mockResolvedValue({
        id: 'dash-b',
        organizationId: 'org-alpha',
        userId: testUserB.id,
        name: "User B's Dashboard",
      });

      await expect(
        dashboardsService.updateLayout(testUserA, 'dash-b', {
          layout: { version: 1, columns: 12, rowHeight: 80, widgets: [] },
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Security Scenario D: User A applying template to User B dashboard should be rejected (ForbiddenException)', async () => {
      mockPrisma.organizationUser.findFirst.mockResolvedValue({
        organizationId: 'org-alpha',
      });
      mockPrisma.dashboard.findFirst.mockResolvedValue({
        id: 'dash-b',
        organizationId: 'org-alpha',
        userId: testUserB.id,
        name: "User B's Dashboard",
      });

      await expect(
        dashboardsService.applyTemplate(testUserA, 'dash-b', {
          templateId: 'tpl-1',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should deep-copy template layout when applying a template to own dashboard', async () => {
      mockPrisma.organizationUser.findFirst.mockResolvedValue({
        organizationId: 'org-alpha',
      });

      const existingDashboard = {
        id: 'dash-1',
        organizationId: 'org-alpha',
        userId: 'user-a',
        name: 'My Dashboard',
        layout: { version: 1, columns: 12, rowHeight: 80, widgets: [] },
      };
      mockPrisma.dashboard.findFirst.mockResolvedValue(existingDashboard);

      const templateLayout = {
        version: 1,
        columns: 12,
        rowHeight: 80,
        widgets: [
          {
            id: 'w-1',
            type: 'sales-chart',
            position: { x: 0, y: 0, w: 6, h: 4 },
          },
        ],
      };
      const existingTemplate = {
        id: 'tpl-1',
        organizationId: 'org-alpha',
        name: 'Store Overview',
        layout: templateLayout,
      };
      mockPrisma.dashboardTemplate.findFirst.mockResolvedValue(existingTemplate);

      mockPrisma.dashboard.update.mockImplementation(({ data }) => {
        return Promise.resolve({
          ...existingDashboard,
          layout: data.layout,
        });
      });

      const updated = await dashboardsService.applyTemplate(
        testUserA,
        'dash-1',
        {
          templateId: 'tpl-1',
        },
      );

      expect(updated.layout).toEqual(templateLayout);
      templateLayout.widgets.push({
        id: 'w-2',
        type: 'revenue-kpi',
        position: { x: 6, y: 0, w: 6, h: 4 },
      });
      expect(updated.layout).not.toEqual(templateLayout);
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DASHBOARD_TEMPLATE_APPLIED' }),
      );
    });
  });

  describe('DashboardTemplatesService - System Template Protection', () => {
    it('should prevent modification of system templates', async () => {
      mockPrisma.organizationUser.findFirst.mockResolvedValue({
        organizationId: 'org-alpha',
      });
      mockPrisma.dashboardTemplate.findFirst.mockResolvedValue({
        id: 'sys-tpl-1',
        name: 'System Default Layout',
        isSystem: true,
        organizationId: 'system-org',
      });

      await expect(
        templatesService.update(testUserA, 'sys-tpl-1', {
          name: 'Renamed System Layout',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should prevent deletion of system templates', async () => {
      mockPrisma.organizationUser.findFirst.mockResolvedValue({
        organizationId: 'org-alpha',
      });
      mockPrisma.dashboardTemplate.findFirst.mockResolvedValue({
        id: 'sys-tpl-1',
        name: 'System Default Layout',
        isSystem: true,
        organizationId: 'system-org',
      });

      await expect(
        templatesService.delete(testUserA, 'sys-tpl-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('VisualThemesService - Default Theme Handling', () => {
    it('should automatically clear other default themes when setting a theme as default', async () => {
      mockPrisma.organizationUser.findFirst.mockResolvedValue({
        organizationId: 'org-alpha',
      });
      mockPrisma.visualTheme.findFirst.mockResolvedValue({
        id: 'theme-2',
        organizationId: 'org-alpha',
        name: 'Dark Luxe',
        isDefault: false,
      });

      await themesService.setDefault(testUserA, 'theme-2');

      expect(mockPrisma.visualTheme.updateMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-alpha',
          isDefault: true,
          NOT: { id: 'theme-2' },
        },
        data: { isDefault: false },
      });
      expect(mockPrisma.visualTheme.update).toHaveBeenCalledWith({
        where: { id: 'theme-2' },
        data: { isDefault: true },
      });
    });
  });
});
