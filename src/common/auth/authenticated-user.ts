export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string | null;
  roles: string[];
  permissions: string[];
}
