import { Prisma } from '@prisma/client';

export async function queueReceiptDelivery(tx: Prisma.TransactionClient, input: { organizationId: string; saleId: string; receiptId: string; customer: { id: string; email: string | null; phone: string | null }; publicUrl: string }) {
  const channels = [{ channel: 'EMAIL' as const, recipient: input.customer.email }, { channel: 'WHATSAPP' as const, recipient: input.customer.phone }];
  const preferences = await tx.notificationPreference.findMany({ where: { customerId: input.customer.id, eventType: 'SALE_RECEIPT' } });
  const event = await tx.domainEvent.create({ data: { organizationId: input.organizationId, aggregateType: 'SALE', aggregateId: input.saleId, eventType: 'SALE_RECEIPT', payload: { receiptId: input.receiptId, receiptUrl: input.publicUrl } } });
  const body = `Your TechNova receipt: ${input.publicUrl}\nThis private link expires in 30 days. Do not share it.`;
  await tx.notificationOutbox.createMany({ data: channels.filter(c => c.recipient && !preferences.some(p => p.channel === c.channel && !p.enabled)).map(c => ({ domainEventId: event.id, channel: c.channel, recipient: c.recipient!, subject: c.channel === 'EMAIL' ? 'Your purchase receipt' : null, body, idempotencyKey: `sale-receipt:${input.receiptId}:${c.channel}` })), skipDuplicates: true });
}
