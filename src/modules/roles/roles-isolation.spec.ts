import { RolesService } from './roles.service';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
const actor: AuthenticatedUser = { id:'tenant-owner', email:'owner@test.invalid', name:'Owner', roles:['SUPER_ADMIN'], permissions:[] };
const context = { ipHash: 'local-test', userAgent: null };
describe('tenant role boundary', () => {
  it('denies editing the platform role even to tenant SUPER_ADMIN', async () => {
    const update = jest.fn();
    const service = new RolesService({ role:{findUnique:jest.fn().mockResolvedValue({name:'PLATFORM_SUPER_ADMIN'}),update} } as unknown as PrismaService, {} as AuditService);
    await expect(service.update(actor,'platform',{description:'changed'},context)).rejects.toThrow('immutable');
    expect(update).not.toHaveBeenCalled();
  });
  it('cannot edit another tenant role', async () => {
    const service = new RolesService({ organizationUser:{findMany:jest.fn().mockResolvedValue([{organizationId:'tenant-a'}])}, role:{findUnique:jest.fn().mockResolvedValue({id:'role-b',name:'CASHIER',scope:'tenant-b'})} } as unknown as PrismaService, {} as AuditService);
    await expect(service.update(actor,'role-b',{description:'changed'},context)).rejects.toThrow('Role not found');
  });
  it('does not mutate the global template when a tenant customizes it', async () => {
    const globalRole={id:'global-cashier',name:'CASHIER',scope:'GLOBAL',permissions:[{permissionId:'p1'}]};
    const localRole={...globalRole,id:'local-cashier',scope:'tenant-a'};
    const tx={role:{upsert:jest.fn().mockResolvedValue(localRole),update:jest.fn()},userRole:{findMany:jest.fn().mockResolvedValue([{userId:'cashier-a'}]),createMany:jest.fn(),deleteMany:jest.fn()},rolePermission:{deleteMany:jest.fn(),createMany:jest.fn()},user:{updateMany:jest.fn()}};
    const prisma={organizationUser:{findMany:jest.fn().mockResolvedValue([{organizationId:'tenant-a'}])},role:{findUnique:jest.fn().mockResolvedValue(globalRole)},permission:{count:jest.fn().mockResolvedValue(1)},$transaction:jest.fn(fn=>fn(tx))};
    const service=new RolesService(prisma as unknown as PrismaService,{record:jest.fn()} as unknown as AuditService);
    await service.update(actor,globalRole.id,{permissionIds:['p2']},context);
    expect(tx.role.update).toHaveBeenCalledWith({where:{id:'local-cashier'},data:{name:'CASHIER',description:undefined}});
    expect(tx.userRole.findMany).toHaveBeenCalledWith({where:{roleId:'global-cashier',user:{organizationMemberships:{some:{organizationId:'tenant-a'}}}}});
  });
});
