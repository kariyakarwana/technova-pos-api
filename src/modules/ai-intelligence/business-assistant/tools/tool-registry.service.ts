import { Injectable, Logger } from '@nestjs/common';
import { IBusinessTool } from './business-tool.interface';

@Injectable()
export class ToolRegistryService {
  private readonly logger = new Logger(ToolRegistryService.name);
  private readonly tools = new Map<string, IBusinessTool>();

  register(tool: IBusinessTool): void {
    if (this.tools.has(tool.name)) {
      this.logger.warn(`Tool "${tool.name}" is already registered. Overwriting with new instance.`);
    }
    this.tools.set(tool.name, tool);
    this.logger.log(`Registered tool: ${tool.name}`);
  }

  get(name: string): IBusinessTool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  getAllTools(): IBusinessTool[] {
    return Array.from(this.tools.values());
  }

  getAvailableTools(userPermissions: string[]): IBusinessTool[] {
    const isSuperAdmin = userPermissions.includes('SUPER_ADMIN');
    return this.getAllTools().filter((tool) => {
      if (isSuperAdmin || !tool.requiredPermissions.length) {
        return true;
      }
      return tool.requiredPermissions.every((perm) => userPermissions.includes(perm));
    });
  }

  getToolDeclarations(userPermissions: string[]): Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }> {
    return this.getAvailableTools(userPermissions).map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameterSchema,
    }));
  }
}
