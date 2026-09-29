import { Injectable, Logger } from '@nestjs/common';
import { RecordStatus } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma/prisma.service';
import {
  IBusinessTool,
  ToolExecutionContext,
  ToolParameterSchema,
  ToolResult,
} from './business-tool.interface';
import { ToolRegistryService } from './tool-registry.service';

export type BranchOperation =
  | 'branch_list'
  | 'branch_details'
  | 'branch_summary'
  | 'branch_comparison_context';

export interface BranchesToolParams {
  operation?: BranchOperation;
  branchId?: string;
  branchCode?: string;
}

@Injectable()
export class BranchesTool implements IBusinessTool<BranchesToolParams> {
  readonly name = 'BranchesTool';
  readonly description = 'Queries store branches, branch details, active locations, and branch comparison metadata.';
  readonly requiredPermissions = ['dashboard:view'];

  readonly parameterSchema: Record<string, ToolParameterSchema> = {
    operation: {
      type: 'string',
      description: 'The branch query operation: branch_list, branch_details, branch_summary, or branch_comparison_context',
      required: true,
      enum: ['branch_list', 'branch_details', 'branch_summary', 'branch_comparison_context'],
    },
    branchId: {
      type: 'string',
      description: 'Optional branch ID filter or lookup target',
      required: false,
    },
    branchCode: {
      type: 'string',
      description: 'Optional branch code for lookup',
      required: false,
    },
  };

  private readonly logger = new Logger(BranchesTool.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ToolRegistryService,
  ) {
    this.registry.register(this);
  }

  async execute(params: BranchesToolParams, context: ToolExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    const operation = params.operation ?? 'branch_list';

    // Verify branch isolation if user is restricted to a branch
    if (context.branchId && params.branchId && params.branchId !== context.branchId) {
      return {
        success: false,
        error: `User is restricted to branch "${context.branchId}" and cannot access details for branch "${params.branchId}".`,
      };
    }

    try {
      let data: unknown;
      let recordCount = 0;

      switch (operation) {
        case 'branch_list': {
          const list = await this.executeBranchList(context.organizationId, context.branchId);
          data = list;
          recordCount = list.length;
          break;
        }

        case 'branch_details': {
          const targetId = params.branchId ?? context.branchId;
          const details = await this.executeBranchDetails(context.organizationId, targetId, params.branchCode);
          data = details;
          recordCount = details ? 1 : 0;
          break;
        }

        case 'branch_summary': {
          const summary = await this.executeBranchSummary(context.organizationId, context.branchId);
          data = summary;
          recordCount = summary.totalBranches;
          break;
        }

        case 'branch_comparison_context': {
          const compContext = await this.executeBranchComparisonContext(context.organizationId, context.branchId);
          data = compContext;
          recordCount = compContext.length;
          break;
        }

        default:
          return {
            success: false,
            error: `Unsupported branch operation "${operation}". Supported operations are: branch_list, branch_details, branch_summary, branch_comparison_context.`,
          };
      }

      return {
        success: true,
        data,
        metadata: {
          source: 'BranchesDatabase',
          recordCount,
          durationMs: Date.now() - startTime,
        },
      };
    } catch (err: unknown) {
      this.logger.error(`BranchesTool failed executing operation "${operation}"`, err);
      return {
        success: false,
        error: 'An internal error occurred while retrieving branch information.',
      };
    }
  }

  private async executeBranchList(organizationId: string, restrictedBranchId?: string) {
    const where: Record<string, unknown> = {
      organizationId,
      status: RecordStatus.ACTIVE,
      ...(restrictedBranchId ? { id: restrictedBranchId } : {}),
    };

    const branches = await this.prisma.branch.findMany({
      where,
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        createdAt: true,
      },
      orderBy: { name: 'asc' },
    });

    return branches.map((b) => ({
      branchId: b.id,
      code: b.code,
      name: b.name,
      status: b.status,
      createdAt: b.createdAt.toISOString(),
    }));
  }

  private async executeBranchDetails(
    organizationId: string,
    branchId?: string,
    branchCode?: string,
  ) {
    if (!branchId && !branchCode) {
      return null;
    }

    const where: Record<string, unknown> = {
      organizationId,
    };
    if (branchId) where.id = branchId;
    if (branchCode) where.code = branchCode;

    const branch = await this.prisma.branch.findFirst({
      where,
      include: {
        _count: {
          select: {
            sales: true,
            stockLevels: true,
            users: true,
          },
        },
      },
    });

    if (!branch) return null;

    return {
      branchId: branch.id,
      code: branch.code,
      name: branch.name,
      status: branch.status,
      totalSalesCount: branch._count.sales,
      trackedStockRecordsCount: branch._count.stockLevels,
      assignedStaffCount: branch._count.users,
      createdAt: branch.createdAt.toISOString(),
    };
  }

  private async executeBranchSummary(organizationId: string, restrictedBranchId?: string) {
    const whereOrg = {
      organizationId,
      ...(restrictedBranchId ? { id: restrictedBranchId } : {}),
    };

    const [totalBranches, activeBranches, inactiveBranches] = await Promise.all([
      this.prisma.branch.count({ where: whereOrg }),
      this.prisma.branch.count({ where: { ...whereOrg, status: RecordStatus.ACTIVE } }),
      this.prisma.branch.count({ where: { ...whereOrg, status: RecordStatus.INACTIVE } }),
    ]);

    return {
      totalBranches,
      activeBranches,
      inactiveBranches,
      isRestrictedScope: Boolean(restrictedBranchId),
    };
  }

  private async executeBranchComparisonContext(organizationId: string, restrictedBranchId?: string) {
    const where: Record<string, unknown> = {
      organizationId,
      status: RecordStatus.ACTIVE,
      ...(restrictedBranchId ? { id: restrictedBranchId } : {}),
    };

    const branches = await this.prisma.branch.findMany({
      where,
      select: {
        id: true,
        code: true,
        name: true,
        _count: {
          select: {
            sales: true,
            stockLevels: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return branches.map((b) => ({
      branchId: b.id,
      code: b.code,
      name: b.name,
      totalSalesCompleted: b._count.sales,
      inventoryProductsStocked: b._count.stockLevels,
    }));
  }
}
