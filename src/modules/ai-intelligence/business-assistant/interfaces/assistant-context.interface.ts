export interface AssistantRequestContext {
  userId: string;
  organizationId: string;
  branchId?: string;
  userPermissions: string[];
  userRoles: string[];
  userName?: string | null;
}
