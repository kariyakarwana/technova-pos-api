import { SubscriptionsService } from './subscriptions.service';
import { PrismaService } from '../../database/prisma/prisma.service';
import { QuotaService } from './quota.service';
describe('subscription settlement', () => {
  it('cannot settle an invoice with an unverified tenant request', async () => {
    const transaction = jest.fn();
    const service = new SubscriptionsService({ $transaction: transaction } as unknown as PrismaService, {} as QuotaService);
    await expect(service.payInvoiceOnline('tenant-a','invoice-a',{gatewayRef:'invented'})).rejects.toThrow('Online payment is unavailable');
    expect(transaction).not.toHaveBeenCalled();
  });
});
