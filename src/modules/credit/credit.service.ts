import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CreditStatus,
  InstallmentStatus,
  PaymentMethod,
  PaymentStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { paginate } from '../../common/dto/pagination.dto';
import type { SecurityRequestContext } from '../../common/security/request';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreditQueryDto, CreditRepaymentDto } from './dto/credit.dto';
@Injectable()
export class CreditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}
  private async org(userId: string) {
    const m = await this.prisma.organizationUser.findFirst({
      where: { userId },
    });
    if (!m) throw new NotFoundException('Organization not found.');
    return m.organizationId;
  }
  private async markOverdue(org: string) {
    const now = new Date();
    await this.prisma.creditInstallment.updateMany({
      where: {
        dueDate: { lt: now },
        status: {
          in: [InstallmentStatus.PENDING, InstallmentStatus.PARTIALLY_PAID],
        },
        creditAgreement: { customer: { organizationId: org } },
      },
      data: { status: InstallmentStatus.OVERDUE },
    });
    await this.prisma.creditAgreement.updateMany({
      where: {
        dueDate: { lt: now },
        status: CreditStatus.ACTIVE,
        customer: { organizationId: org },
      },
      data: { status: CreditStatus.OVERDUE },
    });
  }
  async list(userId: string, q: CreditQueryDto) {
    const org = await this.org(userId);
    await this.markOverdue(org);
    const where = {
      customer: { organizationId: org },
      customerId: q.customerId,
      status: q.status as CreditStatus | undefined,
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.creditAgreement.findMany({
        where,
        skip: q.skip,
        take: q.pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: {
            select: { customerNumber: true, firstName: true, lastName: true },
          },
          sale: { select: { invoiceNumber: true } },
          installments: true,
        },
      }),
      this.prisma.creditAgreement.count({ where }),
    ]);
    return paginate(data, total, q);
  }
  async detail(userId: string, id: string) {
    const org = await this.org(userId);
    await this.markOverdue(org);
    const value = await this.prisma.creditAgreement.findFirst({
      where: { id, customer: { organizationId: org } },
      include: {
        customer: true,
        sale: true,
        installments: { orderBy: { installmentNumber: 'asc' } },
        allocations: {
          include: { payment: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!value) throw new NotFoundException('Credit agreement not found.');
    return value;
  }
  async repay(
    actor: AuthenticatedUser,
    id: string,
    dto: CreditRepaymentDto,
    context: SecurityRequestContext,
  ) {
    if (dto.method === PaymentMethod.CREDIT)
      throw new BadRequestException('Credit cannot be used to repay credit.');
    const agreement = await this.detail(actor.id, id);
    if (
      agreement.status !== CreditStatus.ACTIVE &&
      agreement.status !== CreditStatus.OVERDUE
    )
      throw new ConflictException(
        'This credit agreement does not accept payments.',
      );
    if (dto.amount > Number(agreement.outstandingBalance) + 0.01)
      throw new BadRequestException('Payment exceeds the outstanding balance.');
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          method: dto.method,
          status: PaymentStatus.COMPLETED,
          amount: dto.amount,
          referenceNumber: dto.referenceNumber,
          paidAt: now,
        },
      });
      let remaining = dto.amount;
      for (const installment of agreement.installments) {
        if (remaining <= 0) break;
        const owed =
          Number(installment.amountDue) - Number(installment.amountPaid);
        if (owed <= 0) continue;
        const allocated = Math.min(remaining, owed),
          newPaid = Number(installment.amountPaid) + allocated;
        await tx.creditInstallment.update({
          where: { id: installment.id },
          data: {
            amountPaid: newPaid,
            status:
              newPaid + 0.001 >= Number(installment.amountDue)
                ? InstallmentStatus.PAID
                : installment.dueDate < now
                  ? InstallmentStatus.OVERDUE
                  : InstallmentStatus.PARTIALLY_PAID,
            paidAt:
              newPaid + 0.001 >= Number(installment.amountDue) ? now : null,
          },
        });
        await tx.creditPaymentAllocation.create({
          data: {
            creditAgreementId: id,
            creditInstallmentId: installment.id,
            paymentId: payment.id,
            amount: allocated,
          },
        });
        remaining -= allocated;
      }
      const outstanding = Number(agreement.outstandingBalance) - dto.amount,
        paid = outstanding <= 0.01;
      await tx.creditAgreement.update({
        where: { id },
        data: {
          outstandingBalance: Math.max(0, outstanding),
          status: paid
            ? CreditStatus.PAID
            : agreement.dueDate < now
              ? CreditStatus.OVERDUE
              : CreditStatus.ACTIVE,
        },
      });
      await tx.sale.update({
        where: { id: agreement.saleId },
        data: {
          paidTotal: { increment: dto.amount },
          balanceDue: Math.max(0, outstanding),
        },
      });
      return {
        paymentId: payment.id,
        outstandingBalance: Math.max(0, outstanding),
        status: paid
          ? CreditStatus.PAID
          : agreement.dueDate < now
            ? CreditStatus.OVERDUE
            : CreditStatus.ACTIVE,
      };
    });
    await this.audit.record({
      userId: actor.id,
      action: 'CREDIT_PAYMENT_RECEIVED',
      context,
      metadata: {
        creditAgreementId: id,
        paymentId: result.paymentId,
        amount: dto.amount,
      },
    });
    return result;
  }
}
