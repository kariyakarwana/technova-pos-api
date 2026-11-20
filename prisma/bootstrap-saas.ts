import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from 'bcryptjs';
import { plansData } from './saas-catalog';

// Deliberately separate from the destructive development/demo seed.
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
async function main() {
  const apply = process.argv.includes('--apply');
  if (!apply && !process.argv.includes('--check')) throw new Error('Choose --check or --apply.');
  const email = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email || !email.includes('@')) throw new Error('PLATFORM_ADMIN_EMAIL is required.');
  const missing = await prisma.organization.findMany({ where: { subscription: null }, select: { id: true, name: true, _count: { select: { branches: true, users: true } } } });
  const existing = await prisma.user.findUnique({ where: { email }, include: { roles: { include: { role: true } }, organizationMemberships: true } });
  if (existing && (!existing.roles.some(r => r.role.name === 'PLATFORM_SUPER_ADMIN') || existing.organizationMemberships.length)) throw new Error('Refusing to promote an existing non-platform or tenant account. Choose a dedicated platform email.');
  const ambiguous = await prisma.organizationUser.groupBy({ by: ['userId'], _count: { userId: true }, having: { userId: { _count: { gt: 1 } } } });
  if (ambiguous.length) throw new Error(`${ambiguous.length} users have multiple organization memberships; resolve before rollout.`);
  if (await prisma.subscription.count({ where: { plan: { billingCycle: { not: 'MONTHLY' } } } })) throw new Error('V1 supports monthly subscriptions only. Review existing non-monthly subscriptions before rollout.');
  console.info(JSON.stringify({ mode: apply ? 'apply' : 'check', platformAccountExists: Boolean(existing), organizationsWithoutSubscription: missing.map(o => ({id:o.id,name:o.name})) },null,2));
  if (!apply) {
    if (!existing || missing.length) throw new Error('SaaS bootstrap/backfill is incomplete. Review explicit settings and run --apply during maintenance.');
    return;
  }
  const password = process.env.PLATFORM_ADMIN_PASSWORD;
  if (!existing && (!password || password.length < 16 || ['PlatformAdmin#2026','PlatformAdmin@123456'].includes(password))) throw new Error('Supply a new unique PLATFORM_ADMIN_PASSWORD of at least 16 characters through the server secret file.');
  const planCode = process.env.SAAS_LEGACY_PLAN_CODE?.toUpperCase();
  const end = new Date(process.env.SAAS_LEGACY_PERIOD_END ?? '');
  const plan = planCode ? await prisma.plan.findUnique({ where: { code: planCode } }) ?? plansData.find(p=>p.code===planCode) : undefined;
  if (missing.length && (!plan || !Number.isFinite(end.getTime()) || end<=new Date())) throw new Error('Explicit SAAS_LEGACY_PLAN_CODE and future ISO SAAS_LEGACY_PERIOD_END are required for existing organizations.');
  if (missing.some(o=>o._count.branches>plan!.maxBranches || o._count.users>plan!.maxInternalUsers)) throw new Error('Selected legacy plan is below existing branch/user usage. Choose a sufficient plan; no data was changed.');
  const passwordHash = existing ? undefined : await hash(password!,12);
  await prisma.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(726465831)`;
    for (const entry of plansData) await tx.plan.upsert({where:{code:entry.code},update:{},create:entry});
    const role=await tx.role.upsert({where:{scope_name:{scope:'GLOBAL',name:'PLATFORM_SUPER_ADMIN'}},update:{},create:{scope:'GLOBAL',name:'PLATFORM_SUPER_ADMIN',description:'NxCodeWorks platform owner',isSystem:true}});
    if (!existing) {
      const user=await tx.user.create({data:{email,name:'Platform Administrator',passwordHash:passwordHash!,emailVerified:new Date(),status:'ACTIVE',mustChangePassword:true,roles:{create:{roleId:role.id}}}});
      await tx.auditEvent.create({data:{userId:user.id,action:'SAAS_PLATFORM_BOOTSTRAPPED',outcome:'SUCCESS',metadata:{source:'bootstrap-saas'}}});
    }
    if (missing.length) {
      const selected=await tx.plan.findUniqueOrThrow({where:{code:planCode!}});
      for(const org of missing) await tx.subscription.upsert({where:{organizationId:org.id},update:{},create:{organizationId:org.id,planId:selected.id,status:'ACTIVE',billingAnchorDay:end.getUTCDate(),currentPeriodStart:new Date(),currentPeriodEnd:end}});
      await tx.auditEvent.create({data:{action:'SAAS_LEGACY_SUBSCRIPTIONS_BACKFILLED',outcome:'SUCCESS',metadata:{organizationIds:missing.map(o=>o.id),planCode,periodEnd:end.toISOString()}}});
    }
  });
  console.info('Bootstrap completed. Existing passwords, plans and subscriptions were not overwritten. No demo records or retrospective invoices were created.');
}
main().catch(e=>{console.error(e instanceof Error?e.message:'Bootstrap failed');process.exitCode=1;}).finally(()=>prisma.$disconnect());
